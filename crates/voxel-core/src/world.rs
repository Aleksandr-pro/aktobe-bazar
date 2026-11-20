//! Streaming multi-chunk world: chunk grid math, chunk loading, world-space
//! block access, mesh extraction and world-space voxel raycasting.
//!
//! Everything here stays platform independent and deterministic so the same
//! rules drive the Android client, the tests and any future tooling.

use std::collections::{BTreeSet, HashMap};

use crate::{
    build_chunk_mesh, march_ray, Block, BlockHit, Chunk, ChunkMesh, ChunkNeighbors, MeshData,
    CHUNK_SIZE,
};

/// Number of blocks along one chunk edge as a signed integer.
pub const CHUNK_EDGE: i32 = CHUNK_SIZE as i32;

/// Integer position of a chunk inside the infinite chunk grid.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ChunkPos {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl ChunkPos {
    #[must_use]
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    /// Chunk that contains the given world voxel coordinate.
    #[must_use]
    pub const fn from_world(x: i32, y: i32, z: i32) -> Self {
        Self {
            x: x.div_euclid(CHUNK_EDGE),
            y: y.div_euclid(CHUNK_EDGE),
            z: z.div_euclid(CHUNK_EDGE),
        }
    }

    /// World voxel coordinate of this chunk's minimum corner.
    #[must_use]
    pub const fn origin(self) -> [i32; 3] {
        [
            self.x * CHUNK_EDGE,
            self.y * CHUNK_EDGE,
            self.z * CHUNK_EDGE,
        ]
    }

    #[must_use]
    pub const fn offset(self, dx: i32, dy: i32, dz: i32) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            z: self.z + dz,
        }
    }

    /// Squared horizontal distance, used for streaming rings.
    #[must_use]
    pub const fn horizontal_distance_squared(self, other: Self) -> i32 {
        let dx = self.x - other.x;
        let dz = self.z - other.z;
        dx * dx + dz * dz
    }
}

/// Convert a world voxel coordinate into its chunk-local index.
#[must_use]
pub const fn chunk_local(coordinate: i32) -> usize {
    coordinate.rem_euclid(CHUNK_EDGE) as usize
}

/// Multi-chunk world with lazy generation and dirty-chunk tracking.
///
/// A chunk that has never been loaded reads as air, which keeps raycasts and
/// collision stable while the streaming ring catches up. Callers decide how
/// large a ring to keep in memory.
#[derive(Clone, Debug)]
pub struct World {
    seed: u64,
    chunks: HashMap<ChunkPos, Chunk>,
    dirty: BTreeSet<ChunkPos>,
}

impl World {
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self {
            seed,
            chunks: HashMap::new(),
            dirty: BTreeSet::new(),
        }
    }

    #[must_use]
    pub const fn seed(&self) -> u64 {
        self.seed
    }

    #[must_use]
    pub fn loaded_chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Chunk positions currently held in memory.
    pub fn chunk_positions(&self) -> impl Iterator<Item = ChunkPos> + '_ {
        self.chunks.keys().copied()
    }

    #[must_use]
    pub fn chunk(&self, position: ChunkPos) -> Option<&Chunk> {
        self.chunks.get(&position)
    }

    /// Read a world-space block. Unloaded chunks read as `None`.
    #[must_use]
    pub fn block(&self, x: i32, y: i32, z: i32) -> Option<Block> {
        self.chunk(ChunkPos::from_world(x, y, z))?.get(
            chunk_local(x),
            chunk_local(y),
            chunk_local(z),
        )
    }

    /// Read a world-space block, treating unloaded chunks as air.
    #[must_use]
    pub fn block_or_air(&self, x: i32, y: i32, z: i32) -> Block {
        self.block(x, y, z).unwrap_or(Block::Air)
    }

    #[must_use]
    pub fn is_solid(&self, x: i32, y: i32, z: i32) -> bool {
        self.block_or_air(x, y, z).is_solid()
    }

    /// Write a world-space block. Returns the previous block, or `None` when
    /// the target chunk is not loaded.
    pub fn set_block(&mut self, x: i32, y: i32, z: i32, block: Block) -> Option<Block> {
        let position = ChunkPos::from_world(x, y, z);
        let local = (chunk_local(x), chunk_local(y), chunk_local(z));
        let chunk = self.chunks.get_mut(&position)?;
        let previous = chunk.set(local.0, local.1, local.2, block)?;
        if previous == block {
            return Some(previous);
        }

        self.dirty.insert(position);
        let last = CHUNK_SIZE - 1;
        let mut edge_offsets: Vec<(i32, i32, i32)> = Vec::with_capacity(3);
        if local.0 == 0 {
            edge_offsets.push((-1, 0, 0));
        }
        if local.0 == last {
            edge_offsets.push((1, 0, 0));
        }
        if local.1 == 0 {
            edge_offsets.push((0, -1, 0));
        }
        if local.1 == last {
            edge_offsets.push((0, 1, 0));
        }
        if local.2 == 0 {
            edge_offsets.push((0, 0, -1));
        }
        if local.2 == last {
            edge_offsets.push((0, 0, 1));
        }
        for (dx, dy, dz) in edge_offsets {
            let neighbor = position.offset(dx, dy, dz);
            if self.chunks.contains_key(&neighbor) {
                self.dirty.insert(neighbor);
            }
        }
        Some(previous)
    }

    /// Queue a chunk for remeshing.
    pub fn mark_dirty(&mut self, position: ChunkPos) {
        self.dirty.insert(position);
    }

    pub fn mark_all_dirty(&mut self) {
        self.dirty.extend(self.chunks.keys().copied());
    }

    /// Remove and return every chunk awaiting a rebuild.
    pub fn take_dirty(&mut self) -> Vec<ChunkPos> {
        std::mem::take(&mut self.dirty).into_iter().collect()
    }

    #[must_use]
    pub fn has_dirty(&self) -> bool {
        !self.dirty.is_empty()
    }

    /// Generate and insert one chunk if it is missing. Returns `true` when the
    /// chunk was created by this call.
    pub fn load_chunk(&mut self, position: ChunkPos) -> bool {
        if self.chunks.contains_key(&position) {
            return false;
        }
        self.chunks.insert(
            position,
            Chunk::generate(self.seed, position.x, position.y, position.z),
        );
        self.dirty.insert(position);
        true
    }

    /// Ensure every chunk inside a square ring around `center` exists.
    ///
    /// `level_from`/`level_to` bound the vertical chunk levels; the current
    /// generator only fills the surface level, so one level is usually enough.
    /// Returns the newly generated chunks.
    pub fn stream_around(
        &mut self,
        center: ChunkPos,
        radius: i32,
        level_from: i32,
        level_to: i32,
    ) -> Vec<ChunkPos> {
        let radius = radius.max(0);
        let (level_from, level_to) = if level_from <= level_to {
            (level_from, level_to)
        } else {
            (level_to, level_from)
        };
        let mut created = Vec::new();
        for y in level_from..=level_to {
            for dz in -radius..=radius {
                for dx in -radius..=radius {
                    let position = ChunkPos::new(center.x + dx, y, center.z + dz);
                    if self.load_chunk(position) {
                        created.push(position);
                    }
                }
            }
        }
        created
    }

    /// Drop chunks outside the streaming ring and return their positions.
    pub fn unload_outside(
        &mut self,
        center: ChunkPos,
        radius: i32,
        level_from: i32,
        level_to: i32,
    ) -> Vec<ChunkPos> {
        let radius = radius.max(0);
        let stale: Vec<ChunkPos> = self
            .chunks
            .keys()
            .copied()
            .filter(|position| {
                // Chebyshev distance keeps the unload ring shaped exactly like
                // the square ring produced by `stream_around`, so the two never
                // fight over the same chunks.
                (position.x - center.x).abs() > radius
                    || (position.z - center.z).abs() > radius
                    || position.y < level_from
                    || position.y > level_to
            })
            .collect();
        for position in &stale {
            self.chunks.remove(position);
            self.dirty.remove(position);
        }
        stale
    }

    /// Loaded neighbors around a chunk, for seamless mesh edges.
    #[must_use]
    pub fn neighbors(&self, position: ChunkPos) -> ChunkNeighbors<'_> {
        ChunkNeighbors {
            negative_x: self.chunk(position.offset(-1, 0, 0)),
            positive_x: self.chunk(position.offset(1, 0, 0)),
            negative_y: self.chunk(position.offset(0, -1, 0)),
            positive_y: self.chunk(position.offset(0, 1, 0)),
            negative_z: self.chunk(position.offset(0, 0, -1)),
            positive_z: self.chunk(position.offset(0, 0, 1)),
        }
    }

    /// Build the surface meshes for a loaded chunk, hiding seams against
    /// loaded neighbors and separating liquids for a blended draw pass.
    #[must_use]
    pub fn mesh(&self, position: ChunkPos) -> Option<ChunkMesh> {
        let chunk = self.chunk(position)?;
        Some(build_chunk_mesh(chunk, &self.neighbors(position)))
    }

    /// Convenience wrapper returning only the opaque pass.
    #[must_use]
    pub fn opaque_mesh(&self, position: ChunkPos) -> Option<MeshData> {
        self.mesh(position).map(|mesh| mesh.opaque)
    }

    /// Cast a ray through world space and return the first solid block.
    ///
    /// Unloaded chunks are treated as air so a ray is never blocked by chunks
    /// that simply have not been streamed in yet.
    #[must_use]
    pub fn raycast(
        &self,
        origin: [f32; 3],
        direction: [f32; 3],
        max_distance: f32,
    ) -> Option<BlockHit> {
        march_ray(origin, direction, max_distance, |cell| {
            Some(self.block_or_air(cell[0], cell[1], cell[2]))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_positions_use_euclidean_division_for_negative_coordinates() {
        assert_eq!(ChunkPos::from_world(0, 0, 0), ChunkPos::new(0, 0, 0));
        assert_eq!(ChunkPos::from_world(15, 16, -1), ChunkPos::new(0, 1, -1));
        assert_eq!(
            ChunkPos::from_world(-1, -16, -17),
            ChunkPos::new(-1, -1, -2)
        );
        assert_eq!(chunk_local(-1), CHUNK_SIZE - 1);
        assert_eq!(chunk_local(16), 0);
        assert_eq!(ChunkPos::new(-1, 0, -2).origin(), [-16, 0, -32]);
    }

    #[test]
    fn streaming_loads_the_requested_ring_once() {
        let mut world = World::new(7);
        let created = world.stream_around(ChunkPos::new(0, 0, 0), 1, 0, 0);
        assert_eq!(created.len(), 9);
        assert_eq!(world.loaded_chunk_count(), 9);
        assert!(world
            .stream_around(ChunkPos::new(0, 0, 0), 1, 0, 0)
            .is_empty());
        assert_eq!(world.loaded_chunk_count(), 9);
    }

    #[test]
    fn unloading_drops_chunks_outside_the_ring() {
        let mut world = World::new(3);
        world.stream_around(ChunkPos::new(0, 0, 0), 2, 0, 0);
        assert_eq!(world.loaded_chunk_count(), 25);
        // A 3x3 ring around (2, 0) covers x in 1..=3, but only x = 1..=2 and
        // z = -1..=1 exist inside the streamed area, so six chunks survive.
        let removed = world.unload_outside(ChunkPos::new(2, 0, 0), 1, 0, 0);
        assert_eq!(removed.len(), 19);
        assert_eq!(world.loaded_chunk_count(), 6);
        assert!(world.chunk(ChunkPos::new(0, 0, 0)).is_none());
        assert!(world.chunk(ChunkPos::new(2, 0, 0)).is_some());
    }

    #[test]
    fn world_block_access_spans_chunk_boundaries() {
        let mut world = World::new(11);
        world.stream_around(ChunkPos::new(0, 0, 0), 1, 0, 0);
        assert_eq!(world.block(0, 0, 0), Some(Block::Stone));
        assert!(world.block(15, 1, 15).is_some());
        assert!(world.is_solid(15, 0, 0));
        assert!(world.is_solid(-1, 0, 0));
        assert_eq!(world.set_block(3, 15, 3, Block::Grass), Some(Block::Air));
        assert_eq!(world.block(3, 15, 3), Some(Block::Grass));
        assert_eq!(world.block(500, 3, 3), None);
        assert_eq!(world.set_block(500, 3, 3, Block::Stone), None);
    }

    #[test]
    fn editing_a_chunk_edge_marks_the_neighbor_for_remeshing() {
        let mut world = World::new(5);
        world.stream_around(ChunkPos::new(0, 0, 0), 1, 0, 0);
        let _ = world.take_dirty();
        world
            .set_block(15, 12, 4, Block::Stone)
            .expect("loaded chunk");
        let dirty = world.take_dirty();
        assert!(dirty.contains(&ChunkPos::new(0, 0, 0)));
        assert!(dirty.contains(&ChunkPos::new(1, 0, 0)));
        assert_eq!(dirty.len(), 2);
    }

    #[test]
    fn meshing_hides_faces_against_a_loaded_neighbor() {
        let mut world = World::new(17);
        world.load_chunk(ChunkPos::new(0, 0, 0));
        world
            .set_block(15, 15, 0, Block::Stone)
            .expect("chunk loaded");
        let alone = world.opaque_mesh(ChunkPos::new(0, 0, 0)).expect("chunk loaded");
        world.load_chunk(ChunkPos::new(1, 0, 0));
        world
            .set_block(16, 15, 0, Block::Stone)
            .expect("chunk loaded");
        let paired = world.opaque_mesh(ChunkPos::new(0, 0, 0)).expect("chunk loaded");
        assert!(paired.quad_count() < alone.quad_count());
    }

    #[test]
    fn world_raycast_crosses_chunk_borders_and_reports_world_coordinates() {
        let mut world = World::new(23);
        world.stream_around(ChunkPos::new(0, 0, 0), 1, 0, 0);
        // Clear a corridor so the ray can travel into the next chunk.
        for x in 4..18 {
            world.set_block(x, 13, 4, Block::Air).expect("chunk loaded");
        }
        world
            .set_block(18, 13, 4, Block::Stone)
            .expect("chunk loaded");
        let hit = world
            .raycast([5.5, 13.5, 4.5], [1.0, 0.0, 0.0], 20.0)
            .expect("ray should reach the placed block");
        assert_eq!(hit.position, [18, 13, 4]);
        assert_eq!(hit.normal, [-1, 0, 0]);
        assert_eq!(hit.block, Block::Stone);
        assert!((hit.distance - 12.5).abs() < 0.001);
    }

    #[test]
    fn world_raycast_ignores_unloaded_space() {
        let world = World::new(29);
        assert!(world
            .raycast([0.5, 20.5, 0.5], [0.0, -1.0, 0.0], 8.0)
            .is_none());
    }
}
