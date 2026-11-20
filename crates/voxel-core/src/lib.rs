//! Platform-independent voxel world primitives.
//!
//! This crate intentionally has no engine or platform dependencies so the same
//! deterministic world rules can be used by Android, iOS, desktop tools, and tests.

/// Number of blocks along each edge of a chunk.
pub const CHUNK_SIZE: usize = 16;
/// Number of blocks stored by one chunk.
pub const CHUNK_VOLUME: usize = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/// Initial block palette. Numeric IDs are part of the save/network format; do not
/// reorder existing variants. Add migrations before changing their meaning.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
#[repr(u8)]
pub enum Block {
    #[default]
    Air = 0,
    Grass = 1,
    Soil = 2,
    Stone = 3,
}

impl Block {
    /// Whether a block currently prevents movement and ray traversal.
    #[must_use]
    pub const fn is_solid(self) -> bool {
        !matches!(self, Self::Air)
    }

    /// Decode a stable block ID, rejecting unknown values instead of silently
    /// interpreting corrupt or newer save data as a different block.
    #[must_use]
    pub const fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Self::Air),
            1 => Some(Self::Grass),
            2 => Some(Self::Soil),
            3 => Some(Self::Stone),
            _ => None,
        }
    }

    #[must_use]
    pub const fn id(self) -> u8 {
        self as u8
    }
}

/// A fixed-size, cache-friendly chunk, stored in Y/Z/X order with X contiguous.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chunk {
    blocks: [Block; CHUNK_VOLUME],
}

impl Default for Chunk {
    fn default() -> Self {
        Self::empty()
    }
}

impl Chunk {
    #[must_use]
    pub const fn empty() -> Self {
        Self {
            blocks: [Block::Air; CHUNK_VOLUME],
        }
    }

    /// Read a local block. Out-of-bounds coordinates return `None`.
    #[must_use]
    pub fn get(&self, x: usize, y: usize, z: usize) -> Option<Block> {
        Self::index(x, y, z).map(|index| self.blocks[index])
    }

    /// Set a local block. Returns the previous value, or `None` if out of bounds.
    pub fn set(&mut self, x: usize, y: usize, z: usize, block: Block) -> Option<Block> {
        let index = Self::index(x, y, z)?;
        Some(std::mem::replace(&mut self.blocks[index], block))
    }

    /// Generate a deterministic, intentionally simple starter terrain chunk.
    /// The same seed and chunk coordinates always produce the same block data.
    #[must_use]
    pub fn generate(seed: u64, chunk_x: i32, chunk_y: i32, chunk_z: i32) -> Self {
        let mut chunk = Self::empty();
        let world_y_start = i64::from(chunk_y) * CHUNK_SIZE as i64;
        let world_x_start = i64::from(chunk_x) * CHUNK_SIZE as i64;
        let world_z_start = i64::from(chunk_z) * CHUNK_SIZE as i64;

        for z in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let world_x = world_x_start + x as i64;
                let world_z = world_z_start + z as i64;
                let surface = terrain_height(seed, world_x, world_z);

                for y in 0..CHUNK_SIZE {
                    let world_y = world_y_start + y as i64;
                    let block = if world_y > surface {
                        Block::Air
                    } else if world_y == surface {
                        Block::Grass
                    } else if world_y >= surface - 3 {
                        Block::Soil
                    } else {
                        Block::Stone
                    };
                    let index = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
                    chunk.blocks[index] = block;
                }
            }
        }
        chunk
    }

    /// Read-only view for serialization and mesh generation.
    #[must_use]
    pub const fn blocks(&self) -> &[Block; CHUNK_VOLUME] {
        &self.blocks
    }

    fn index(x: usize, y: usize, z: usize) -> Option<usize> {
        if x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE {
            return None;
        }
        Some((y * CHUNK_SIZE + z) * CHUNK_SIZE + x)
    }
}

/// Already-loaded chunks immediately surrounding a chunk being meshed.
/// Missing neighbors are treated as air, so callers should rebuild the edge
/// mesh when a previously missing neighbor finishes loading.
#[derive(Clone, Copy, Debug, Default)]
pub struct ChunkNeighbors<'a> {
    pub negative_x: Option<&'a Chunk>,
    pub positive_x: Option<&'a Chunk>,
    pub negative_y: Option<&'a Chunk>,
    pub positive_y: Option<&'a Chunk>,
    pub negative_z: Option<&'a Chunk>,
    pub positive_z: Option<&'a Chunk>,
}

/// One vertex in a block surface mesh. Coordinates are local to the chunk and
/// use integer values so the renderer can upload compact vertex attributes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MeshVertex {
    pub position: [u8; 3],
    pub normal: [i8; 3],
    pub block: Block,
}

/// Indexed triangle mesh for the visible faces of a chunk.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MeshData {
    pub vertices: Vec<MeshVertex>,
    pub indices: Vec<u16>,
}

impl MeshData {
    #[must_use]
    pub fn quad_count(&self) -> usize {
        self.indices.len() / 6
    }
}

/// Build a culled surface mesh. This first implementation emits one quad per
/// visible block face; it avoids rendering hidden faces and keeps the algorithm
/// easy to validate before introducing greedy face merging.
#[must_use]
pub fn build_surface_mesh(chunk: &Chunk, neighbors: &ChunkNeighbors<'_>) -> MeshData {
    let mut mesh = MeshData::default();
    for y in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let block = chunk.get(x, y, z).expect("loop coordinates are in bounds");
                if !block.is_solid() {
                    continue;
                }
                for face in Face::ALL {
                    if sample_face_neighbor(chunk, neighbors, x, y, z, face).is_solid() {
                        continue;
                    }
                    append_face(&mut mesh, x, y, z, block, face);
                }
            }
        }
    }
    mesh
}

#[derive(Clone, Copy)]
enum Face {
    NegativeX,
    PositiveX,
    NegativeY,
    PositiveY,
    NegativeZ,
    PositiveZ,
}

impl Face {
    const ALL: [Self; 6] = [
        Self::NegativeX,
        Self::PositiveX,
        Self::NegativeY,
        Self::PositiveY,
        Self::NegativeZ,
        Self::PositiveZ,
    ];

    const fn normal(self) -> [i8; 3] {
        match self {
            Self::NegativeX => [-1, 0, 0],
            Self::PositiveX => [1, 0, 0],
            Self::NegativeY => [0, -1, 0],
            Self::PositiveY => [0, 1, 0],
            Self::NegativeZ => [0, 0, -1],
            Self::PositiveZ => [0, 0, 1],
        }
    }

    fn corners(self, x: usize, y: usize, z: usize) -> [[u8; 3]; 4] {
        let (x, y, z) = (x as u8, y as u8, z as u8);
        match self {
            Self::NegativeX => [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]],
            Self::PositiveX => [
                [x + 1, y, z],
                [x + 1, y + 1, z],
                [x + 1, y + 1, z + 1],
                [x + 1, y, z + 1],
            ],
            Self::NegativeY => [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]],
            Self::PositiveY => [
                [x, y + 1, z],
                [x, y + 1, z + 1],
                [x + 1, y + 1, z + 1],
                [x + 1, y + 1, z],
            ],
            Self::NegativeZ => [[x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]],
            Self::PositiveZ => [
                [x, y, z + 1],
                [x + 1, y, z + 1],
                [x + 1, y + 1, z + 1],
                [x, y + 1, z + 1],
            ],
        }
    }
}

fn sample_face_neighbor(
    chunk: &Chunk,
    neighbors: &ChunkNeighbors<'_>,
    x: usize,
    y: usize,
    z: usize,
    face: Face,
) -> Block {
    let adjacent = match face {
        Face::NegativeX if x > 0 => return chunk.get(x - 1, y, z).unwrap_or(Block::Air),
        Face::PositiveX if x + 1 < CHUNK_SIZE => {
            return chunk.get(x + 1, y, z).unwrap_or(Block::Air)
        }
        Face::NegativeY if y > 0 => return chunk.get(x, y - 1, z).unwrap_or(Block::Air),
        Face::PositiveY if y + 1 < CHUNK_SIZE => {
            return chunk.get(x, y + 1, z).unwrap_or(Block::Air)
        }
        Face::NegativeZ if z > 0 => return chunk.get(x, y, z - 1).unwrap_or(Block::Air),
        Face::PositiveZ if z + 1 < CHUNK_SIZE => {
            return chunk.get(x, y, z + 1).unwrap_or(Block::Air)
        }
        Face::NegativeX => neighbors
            .negative_x
            .and_then(|c| c.get(CHUNK_SIZE - 1, y, z)),
        Face::PositiveX => neighbors.positive_x.and_then(|c| c.get(0, y, z)),
        Face::NegativeY => neighbors
            .negative_y
            .and_then(|c| c.get(x, CHUNK_SIZE - 1, z)),
        Face::PositiveY => neighbors.positive_y.and_then(|c| c.get(x, 0, z)),
        Face::NegativeZ => neighbors
            .negative_z
            .and_then(|c| c.get(x, y, CHUNK_SIZE - 1)),
        Face::PositiveZ => neighbors.positive_z.and_then(|c| c.get(x, y, 0)),
    };
    adjacent.unwrap_or(Block::Air)
}

fn append_face(mesh: &mut MeshData, x: usize, y: usize, z: usize, block: Block, face: Face) {
    // A checkerboard chunk has fewer than 65,536 vertices even when every
    // isolated block emits all six faces, so u16 indices are sufficient.
    let base = mesh.vertices.len() as u16;
    for position in face.corners(x, y, z) {
        mesh.vertices.push(MeshVertex {
            position,
            normal: face.normal(),
            block,
        });
    }
    mesh.indices
        .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
}

/// A solid block hit by a voxel DDA ray. The normal points from the hit block
/// toward the empty voxel the ray came from (useful for block placement).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlockHit {
    pub position: [i32; 3],
    pub normal: [i8; 3],
    pub block: Block,
    pub distance: f32,
}

/// Raycast through one chunk using local-space coordinates. The ray direction
/// is normalized internally; invalid inputs and out-of-chunk rays return None.
#[must_use]
pub fn raycast_chunk(
    chunk: &Chunk,
    origin: [f32; 3],
    direction: [f32; 3],
    max_distance: f32,
) -> Option<BlockHit> {
    if !max_distance.is_finite()
        || max_distance < 0.0
        || origin.iter().any(|v| !v.is_finite())
        || direction.iter().any(|v| !v.is_finite())
    {
        return None;
    }
    let length = (direction[0] * direction[0]
        + direction[1] * direction[1]
        + direction[2] * direction[2])
        .sqrt();
    if !length.is_finite() || length <= f32::EPSILON {
        return None;
    }
    let direction = [direction[0] / length, direction[1] / length, direction[2] / length];
    let mut cell = [origin[0].floor() as i32, origin[1].floor() as i32, origin[2].floor() as i32];
    let chunk_range = 0..CHUNK_SIZE as i32;
    let mut normal = [0_i8; 3];
    let mut distance = 0.0_f32;

    loop {
        if cell.iter().any(|&v| !chunk_range.contains(&v)) {
            return None;
        }
        let block = chunk.get(cell[0] as usize, cell[1] as usize, cell[2] as usize)?;
        if block.is_solid() {
            return Some(BlockHit {
                position: cell,
                normal,
                block,
                distance,
            });
        }

        let axis = next_axis(origin, direction, cell);
        let step = if direction[axis] > 0.0 { 1 } else { -1 };
        let boundary = if step > 0 {
            cell[axis] as f32 + 1.0
        } else {
            cell[axis] as f32
        };
        distance = (boundary - origin[axis]) / direction[axis];
        if distance > max_distance {
            return None;
        }
        cell[axis] += step;
        normal = [0; 3];
        normal[axis] = -(step as i8);
    }
}

fn next_axis(origin: [f32; 3], direction: [f32; 3], cell: [i32; 3]) -> usize {
    let mut axes = origin
        .iter()
        .zip(direction.iter())
        .zip(cell.iter())
        .enumerate();
    let (mut best_axis, ((&first_origin, &first_direction), &first_cell)) =
        axes.next().expect("three ray axes are present");
    let mut best_distance = axis_boundary_distance(first_origin, first_direction, first_cell);

    for (axis, ((&axis_origin, &axis_direction), &axis_cell)) in axes {
        let candidate = axis_boundary_distance(axis_origin, axis_direction, axis_cell);
        if candidate < best_distance {
            best_axis = axis;
            best_distance = candidate;
        }
    }
    best_axis
}

fn axis_boundary_distance(origin: f32, direction: f32, cell: i32) -> f32 {
    if direction.abs() <= f32::EPSILON {
        return f32::INFINITY;
    }
    let boundary = if direction > 0.0 {
        cell as f32 + 1.0
    } else {
        cell as f32
    };
    (boundary - origin) / direction
}

/// Integer-only terrain function: deliberately stable across platforms and
/// independent of floating-point implementation details.
fn terrain_height(seed: u64, x: i64, z: i64) -> i64 {
    let mut value = seed
        ^ (x as u64).wrapping_mul(0x9E37_79B1_85EB_CA87)
        ^ (z as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    6 + (value % 7) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_access_is_bounded_and_returns_previous_value() {
        let mut chunk = Chunk::empty();
        assert_eq!(chunk.get(0, 0, 0), Some(Block::Air));
        assert_eq!(chunk.set(3, 7, 11, Block::Stone), Some(Block::Air));
        assert_eq!(chunk.get(3, 7, 11), Some(Block::Stone));
        assert_eq!(chunk.set(CHUNK_SIZE, 0, 0, Block::Grass), None);
        assert_eq!(chunk.get(0, CHUNK_SIZE, 0), None);
    }

    #[test]
    fn block_ids_are_stable_and_unknown_values_are_rejected() {
        for block in [Block::Air, Block::Grass, Block::Soil, Block::Stone] {
            assert_eq!(Block::from_id(block.id()), Some(block));
        }
        assert_eq!(Block::from_id(255), None);
        assert!(!Block::Air.is_solid());
        assert!(Block::Stone.is_solid());
    }

    #[test]
    fn terrain_generation_is_deterministic_and_seeded() {
        let a = Chunk::generate(42, -2, 0, 5);
        let b = Chunk::generate(42, -2, 0, 5);
        let different_seed = Chunk::generate(43, -2, 0, 5);
        assert_eq!(a, b);
        assert_ne!(a, different_seed);
    }

    #[test]
    fn generated_chunk_has_surface_soil_stone_and_air() {
        let chunk = Chunk::generate(9, 0, 0, 0);
        assert!(chunk.blocks().contains(&Block::Grass));
        assert!(chunk.blocks().contains(&Block::Soil));
        assert!(chunk.blocks().contains(&Block::Stone));
        assert!(chunk.blocks().contains(&Block::Air));
    }

    #[test]
    fn surface_mesher_culls_internal_faces() {
        let mut chunk = Chunk::empty();
        chunk.set(1, 1, 1, Block::Stone).expect("in bounds");
        chunk.set(2, 1, 1, Block::Stone).expect("in bounds");
        let mesh = build_surface_mesh(&chunk, &ChunkNeighbors::default());
        assert_eq!(mesh.quad_count(), 10);
        assert_eq!(mesh.vertices.len(), 40);
        assert_eq!(mesh.indices.len(), 60);
    }

    #[test]
    fn surface_mesher_uses_loaded_neighbor_to_hide_chunk_seam() {
        let mut chunk = Chunk::empty();
        let mut neighbor = Chunk::empty();
        chunk
            .set(CHUNK_SIZE - 1, 1, 1, Block::Stone)
            .expect("in bounds");
        neighbor.set(0, 1, 1, Block::Stone).expect("in bounds");
        let neighbors = ChunkNeighbors {
            positive_x: Some(&neighbor),
            ..ChunkNeighbors::default()
        };
        let mesh = build_surface_mesh(&chunk, &neighbors);
        assert_eq!(mesh.quad_count(), 5);
    }

    #[test]
    fn raycast_reports_hit_face_and_distance() {
        let mut chunk = Chunk::empty();
        chunk.set(4, 1, 1, Block::Grass).expect("in bounds");
        let hit = raycast_chunk(&chunk, [1.5, 1.5, 1.5], [3.0, 0.0, 0.0], 3.0).unwrap();
        assert_eq!(hit.position, [4, 1, 1]);
        assert_eq!(hit.normal, [-1, 0, 0]);
        assert_eq!(hit.block, Block::Grass);
        assert!((hit.distance - 2.5).abs() < f32::EPSILON);
        assert!(raycast_chunk(&chunk, [1.5, 1.5, 1.5], [1.0, 0.0, 0.0], 2.0).is_none());
    }

    #[test]
    fn raycast_rejects_invalid_directions_and_finds_starting_block() {
        let mut chunk = Chunk::empty();
        chunk.set(1, 1, 1, Block::Stone).expect("in bounds");
        assert!(raycast_chunk(&chunk, [0.5, 1.5, 1.5], [0.0; 3], 5.0).is_none());
        assert!(raycast_chunk(&chunk, [0.5, 1.5, 1.5], [f32::NAN, 0.0, 1.0], 5.0).is_none());
        let hit = raycast_chunk(&chunk, [1.5, 1.5, 1.5], [0.0, 1.0, 0.0], 5.0).unwrap();
        assert_eq!(hit.position, [1, 1, 1]);
        assert_eq!(hit.normal, [0, 0, 0]);
    }
}
