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
                    let _ = chunk.set(x, y, z, block);
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
}
