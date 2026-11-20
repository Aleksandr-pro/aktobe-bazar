//! Smallest possible Macroquad scene for the same Android toolchain as the game.
//!
//! If this APK launches and the game does not, the problem is in game code.
//! If this APK also closes immediately, the problem is the engine/packaging
//! path on the device and no game logic is involved.

use macroquad::prelude::*;

fn window_conf() -> Conf {
    Conf {
        window_title: "Voxel Smoke".to_owned(),
        high_dpi: false,
        fullscreen: true,
        ..Default::default()
    }
}

#[macroquad::main(window_conf)]
async fn main() {
    let mut frames = 0_u32;
    loop {
        frames = frames.wrapping_add(1);
        clear_background(Color::new(0.10, 0.35, 0.75, 1.0));
        draw_text("VOXEL SMOKE OK", 40.0, 120.0, 48.0, WHITE);
        draw_text(
            &format!("frames: {frames}  fps: {}", get_fps()),
            40.0,
            190.0,
            28.0,
            WHITE,
        );
        draw_text(
            "If you can read this, the engine and APK are fine.",
            40.0,
            250.0,
            24.0,
            Color::new(0.9, 0.95, 1.0, 1.0),
        );
        next_frame().await;
    }
}
