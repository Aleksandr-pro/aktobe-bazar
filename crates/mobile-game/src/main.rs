use std::collections::HashMap;

use macroquad::models::{draw_mesh, Mesh, Vertex};
use macroquad::prelude::*;
use voxel_core::{
    build_surface_mesh, raycast_chunk, Block, Chunk, ChunkNeighbors, MeshData, CHUNK_SIZE,
};

const SEED: u64 = 0xA17_0BE;
const PLAYER_RADIUS: f32 = 0.28;
const PLAYER_HEIGHT: f32 = 1.72;
const INTERACTION_DISTANCE: f32 = 5.0;

fn window_conf() -> Conf {
    Conf {
        window_title: "Project Voxel".to_owned(),
        high_dpi: false,
        fullscreen: true,
        ..Default::default()
    }
}

#[derive(Default)]
struct FrameInput {
    movement: Vec2,
    look_delta: Vec2,
    jump: bool,
    mine: bool,
    place: bool,
    selected_slot: Option<usize>,
}

#[derive(Default)]
struct TouchTracker {
    previous_positions: HashMap<u64, Vec2>,
}

impl TouchTracker {
    fn poll(&mut self) -> FrameInput {
        let width = screen_width();
        let height = screen_height();
        let touches = touches();
        let mut input = FrameInput::default();
        let mut current_positions = HashMap::new();
        let joystick_center = vec2(102.0, height - 112.0);
        let joystick_radius = 66.0;

        for touch in touches {
            let position = touch.position;
            let is_ended = matches!(touch.phase, TouchPhase::Ended | TouchPhase::Cancelled);
            if is_ended {
                continue;
            }

            if position.distance(joystick_center) <= joystick_radius + 38.0 {
                let offset = position - joystick_center;
                let mut axis = vec2(offset.x / joystick_radius, -offset.y / joystick_radius);
                let length = axis.length();
                if length > 1.0 {
                    axis /= length;
                }
                input.movement = axis;
            } else if position.x >= width * 0.42 && !is_action_area(position, width, height) {
                if let Some(previous) = self.previous_positions.get(&touch.id) {
                    input.look_delta += position - *previous;
                }
            }

            if touch.phase == TouchPhase::Started {
                if in_circle(position, vec2(width - 100.0, height - 105.0), 58.0) {
                    input.mine = true;
                } else if in_circle(position, vec2(width - 220.0, height - 105.0), 58.0) {
                    input.place = true;
                } else if in_circle(position, vec2(width - 100.0, height - 225.0), 58.0) {
                    input.jump = true;
                } else if let Some(slot) = hotbar_slot_at(position, width, height) {
                    input.selected_slot = Some(slot);
                }
            }

            current_positions.insert(touch.id, position);
        }

        self.previous_positions = current_positions;
        input
    }
}

fn in_circle(point: Vec2, center: Vec2, radius: f32) -> bool {
    point.distance_squared(center) <= radius * radius
}

fn is_action_area(point: Vec2, width: f32, height: f32) -> bool {
    point.x > width - 300.0 && point.y > height - 285.0
}

fn hotbar_slot_at(point: Vec2, width: f32, height: f32) -> Option<usize> {
    let slot_size = 46.0;
    let gap = 6.0;
    let total_width = slot_size * 3.0 + gap * 2.0;
    let left = (width - total_width) * 0.5;
    let top = height - 60.0;
    if point.y < top || point.y > top + slot_size {
        return None;
    }
    (0..3).find(|slot| {
        let slot_left = left + *slot as f32 * (slot_size + gap);
        point.x >= slot_left && point.x <= slot_left + slot_size
    })
}

struct Player {
    position: Vec3,
    vertical_velocity: f32,
    yaw: f32,
    pitch: f32,
    grounded: bool,
}

impl Player {
    fn spawn(chunk: &Chunk) -> Self {
        let x = 8.5;
        let z = 8.5;
        let surface_y = (0..CHUNK_SIZE)
            .rev()
            .find(|&y| chunk.get(x as usize, y, z as usize).is_some_and(Block::is_solid))
            .unwrap_or(0);
        Self {
            position: vec3(x, surface_y as f32 + 1.02, z + 3.0),
            vertical_velocity: 0.0,
            yaw: std::f32::consts::PI,
            pitch: -0.12,
            grounded: false,
        }
    }

    fn forward(&self) -> Vec3 {
        let horizontal = self.pitch.cos();
        vec3(self.yaw.sin() * horizontal, self.pitch.sin(), self.yaw.cos() * horizontal)
    }

    fn eye_position(&self) -> Vec3 {
        self.position + vec3(0.0, 1.52, 0.0)
    }

    fn update(&mut self, chunk: &Chunk, input: &FrameInput, delta_time: f32) {
        self.yaw -= input.look_delta.x * 0.006;
        self.pitch = (self.pitch - input.look_delta.y * 0.005).clamp(-1.25, 1.25);

        let forward = vec3(self.yaw.sin(), 0.0, self.yaw.cos());
        let right = vec3(-self.yaw.cos(), 0.0, self.yaw.sin());
        let mut movement = right * input.movement.x + forward * input.movement.y;
        if movement.length_squared() > 1.0 {
            movement = movement.normalize();
        }
        let horizontal_step = movement * (4.0 * delta_time);
        let try_x = self.position + vec3(horizontal_step.x, 0.0, 0.0);
        if !collides(chunk, try_x) {
            self.position.x = try_x.x;
        }
        let try_z = self.position + vec3(0.0, 0.0, horizontal_step.z);
        if !collides(chunk, try_z) {
            self.position.z = try_z.z;
        }

        if input.jump && self.grounded {
            self.vertical_velocity = 6.2;
            self.grounded = false;
        }
        self.vertical_velocity -= 19.0 * delta_time;
        let next_y = self.position.y + self.vertical_velocity * delta_time;
        let candidate = vec3(self.position.x, next_y, self.position.z);
        if collides(chunk, candidate) {
            if self.vertical_velocity < 0.0 {
                self.position.y = next_y.floor() + 1.0;
                self.grounded = true;
            } else {
                self.position.y = (next_y + PLAYER_HEIGHT).floor() - PLAYER_HEIGHT;
                self.grounded = false;
            }
            self.vertical_velocity = 0.0;
        } else {
            self.position.y = next_y;
            self.grounded = false;
        }

        // Keep the prototype playable if the player walks off the small test island.
        if self.position.y < -8.0 {
            *self = Self::spawn(chunk);
        }
    }
}

fn collides(chunk: &Chunk, position: Vec3) -> bool {
    for x_offset in [-PLAYER_RADIUS, PLAYER_RADIUS] {
        for z_offset in [-PLAYER_RADIUS, PLAYER_RADIUS] {
            let x = (position.x + x_offset).floor() as i32;
            let z = (position.z + z_offset).floor() as i32;
            let feet = (position.y + 0.03).floor() as i32;
            let head = (position.y + PLAYER_HEIGHT - 0.03).floor() as i32;
            if block_is_solid(chunk, x, feet, z) || block_is_solid(chunk, x, head, z) {
                return true;
            }
        }
    }
    false
}

fn block_is_solid(chunk: &Chunk, x: i32, y: i32, z: i32) -> bool {
    let chunk_range = 0..CHUNK_SIZE as i32;
    if !chunk_range.contains(&x) || !chunk_range.contains(&y) || !chunk_range.contains(&z) {
        return false;
    }
    chunk
        .get(x as usize, y as usize, z as usize)
        .is_some_and(Block::is_solid)
}

fn build_render_mesh(data: &MeshData) -> Mesh {
    let vertices = data
        .vertices
        .iter()
        .map(|vertex| {
            let base = match vertex.block {
                Block::Grass => [0.28, 0.67, 0.30],
                Block::Soil => [0.50, 0.32, 0.19],
                Block::Stone => [0.48, 0.51, 0.56],
                Block::Air => [0.0, 0.0, 0.0],
            };
            let light = match vertex.normal {
                [0, 1, 0] => 1.0,
                [0, -1, 0] => 0.55,
                [_, 0, 0] => 0.78,
                _ => 0.88,
            };
            let position = vec3(
                f32::from(vertex.position[0]),
                f32::from(vertex.position[1]),
                f32::from(vertex.position[2]),
            );
            Vertex::new2(
                position,
                vec2(0.0, 0.0),
                Color::new(base[0] * light, base[1] * light, base[2] * light, 1.0),
            )
        })
        .collect();

    Mesh {
        vertices,
        indices: data.indices.clone(),
        texture: None,
    }
}

fn apply_block_action(
    chunk: &mut Chunk,
    player: &Player,
    input: &FrameInput,
    selected: Block,
) -> bool {
    if !input.mine && !input.place {
        return false;
    }
    let eye = player.eye_position();
    let origin = [eye.x, eye.y, eye.z];
    let direction = player.forward();
    let Some(hit) = raycast_chunk(
        chunk,
        origin,
        [direction.x, direction.y, direction.z],
        INTERACTION_DISTANCE,
    ) else {
        return false;
    };

    let target = if input.mine {
        hit.position
    } else {
        if hit.normal == [0, 0, 0] {
            return false;
        }
        [
            hit.position[0] + i32::from(hit.normal[0]),
            hit.position[1] + i32::from(hit.normal[1]),
            hit.position[2] + i32::from(hit.normal[2]),
        ]
    };
    let chunk_range = 0..CHUNK_SIZE as i32;
    if target.iter().any(|coordinate| !chunk_range.contains(coordinate)) {
        return false;
    }

    if input.place {
        let block_position = vec3(target[0] as f32, target[1] as f32, target[2] as f32);
        let player_min = player.position;
        let player_max = player.position + vec3(0.0, PLAYER_HEIGHT, 0.0);
        let intersects_player = block_position.x < player_max.x + PLAYER_RADIUS
            && block_position.x + 1.0 > player_min.x - PLAYER_RADIUS
            && block_position.y < player_max.y
            && block_position.y + 1.0 > player_min.y
            && block_position.z < player_max.z + PLAYER_RADIUS
            && block_position.z + 1.0 > player_min.z - PLAYER_RADIUS;
        if intersects_player {
            return false;
        }
        return chunk.set(target[0] as usize, target[1] as usize, target[2] as usize, selected)
            == Some(Block::Air);
    }

    chunk.set(target[0] as usize, target[1] as usize, target[2] as usize, Block::Air)
        .is_some_and(Block::is_solid)
}

fn draw_touch_ui(input: &FrameInput, selected_slot: usize) {
    let width = screen_width();
    let height = screen_height();
    let joystick_center = vec2(102.0, height - 112.0);
    draw_circle(
        joystick_center.x,
        joystick_center.y,
        68.0,
        Color::new(0.07, 0.09, 0.12, 0.5),
    );
    draw_circle(
        joystick_center.x + input.movement.x * 42.0,
        joystick_center.y - input.movement.y * 42.0,
        27.0,
        Color::new(0.74, 0.82, 0.89, 0.72),
    );

    draw_action_button(
        vec2(width - 100.0, height - 105.0),
        "MINE",
        Color::new(0.68, 0.31, 0.24, 0.82),
    );
    draw_action_button(
        vec2(width - 220.0, height - 105.0),
        "PLACE",
        Color::new(0.30, 0.52, 0.72, 0.82),
    );
    draw_action_button(
        vec2(width - 100.0, height - 225.0),
        "JUMP",
        Color::new(0.77, 0.65, 0.28, 0.82),
    );

    let slot_size = 46.0;
    let gap = 6.0;
    let total_width = slot_size * 3.0 + gap * 2.0;
    let left = (width - total_width) * 0.5;
    let top = height - 60.0;
    let blocks = [Block::Grass, Block::Soil, Block::Stone];
    let labels = ["G", "D", "S"];
    for slot in 0..3 {
        let x = left + slot as f32 * (slot_size + gap);
        let fill = if slot == selected_slot {
            Color::new(0.91, 0.86, 0.67, 0.96)
        } else {
            Color::new(0.10, 0.13, 0.16, 0.78)
        };
        draw_rectangle(x, top, slot_size, slot_size, fill);
        draw_rectangle_lines(x, top, slot_size, slot_size, 2.0, WHITE);
        let swatch = block_color(blocks[slot]);
        draw_rectangle(x + 7.0, top + 7.0, 14.0, 14.0, swatch);
        draw_text(labels[slot], x + 27.0, top + 31.0, 20.0, WHITE);
    }
    draw_text("PROJECT VOXEL  /  MOBILE TEST", 22.0, 36.0, 19.0, WHITE);
    draw_text("Touch left to move  ·  drag right to look", 22.0, 60.0, 15.0, WHITE);
    draw_line(width * 0.5 - 8.0, height * 0.5, width * 0.5 + 8.0, height * 0.5, 2.0, WHITE);
    draw_line(width * 0.5, height * 0.5 - 8.0, width * 0.5, height * 0.5 + 8.0, 2.0, WHITE);
}

fn block_color(block: Block) -> Color {
    match block {
        Block::Grass => Color::new(0.28, 0.67, 0.30, 1.0),
        Block::Soil => Color::new(0.50, 0.32, 0.19, 1.0),
        Block::Stone => Color::new(0.48, 0.51, 0.56, 1.0),
        Block::Air => Color::new(0.0, 0.0, 0.0, 0.0),
    }
}

fn draw_action_button(center: Vec2, label: &str, color: Color) {
    draw_circle(center.x, center.y, 54.0, Color::new(0.02, 0.03, 0.04, 0.45));
    draw_circle(center.x, center.y, 47.0, color);
    let text_size = 17.0;
    let text_width = measure_text(label, None, text_size as u16, 1.0).width;
    draw_text(
        label,
        center.x - text_width * 0.5,
        center.y + text_size * 0.35,
        text_size,
        WHITE,
    );
}

#[macroquad::main(window_conf)]
async fn main() {
    let mut chunk = Chunk::generate(SEED, 0, 0, 0);
    let mut player = Player::spawn(&chunk);
    let mut touch_tracker = TouchTracker::default();
    let mut selected_slot = 0_usize;
    let mut scene = build_render_mesh(&build_surface_mesh(&chunk, &ChunkNeighbors::default()));

    loop {
        let delta_time = get_frame_time().min(0.05);
        let input = touch_tracker.poll();
        if let Some(slot) = input.selected_slot {
            selected_slot = slot;
        }

        player.update(&chunk, &input, delta_time);
        let selected_block = [Block::Grass, Block::Soil, Block::Stone][selected_slot];
        if apply_block_action(&mut chunk, &player, &input, selected_block) {
            scene = build_render_mesh(&build_surface_mesh(&chunk, &ChunkNeighbors::default()));
        }

        clear_background(Color::new(0.44, 0.70, 0.88, 1.0));
        let eye = player.eye_position();
        set_camera(&Camera3D {
            position: eye,
            target: eye + player.forward(),
            up: vec3(0.0, 1.0, 0.0),
            fovy: 68.0,
            ..Default::default()
        });
        draw_mesh(&scene);
        set_default_camera();
        draw_touch_ui(&input, selected_slot);
        next_frame().await;
    }
}
