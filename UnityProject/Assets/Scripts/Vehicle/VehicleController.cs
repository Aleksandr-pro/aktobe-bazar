using UnityEngine;

/// <summary>
/// Простая физика авто на WheelCollider (для A15 — 4 колеса, без Chaos).
/// Левый стик Y — газ/тормоз, X — руль. Кнопка B — выйти.
/// </summary>
public class VehicleController : MonoBehaviour
{
    public WheelCollider[] steerWheels; // передние
    public WheelCollider[] driveWheels; // задние
    public Transform[] wheelMeshes;
    public float motorTorque = 1800f;
    public float brakeTorque = 4000f;
    public float maxSteer = 30f;
    public Transform seat; // куда садится игрок
    public Transform exitPoint;

    bool occupied;
    PlayerController player;
    float steerInput, gasInput;

    void Update()
    {
        if (occupied)
        {
            // читаем ввод: левый стик
            Vector2 mv = Vector2.zero;
            if (UnityEngine.InputSystem.Gamepad.current != null)
                mv = UnityEngine.InputSystem.Gamepad.current.leftStick.ReadValue();
            // WASD fallback
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb != null)
            {
                if (kb.wKey.isPressed) mv.y += 1;
                if (kb.sKey.isPressed) mv.y -= 1;
                if (kb.aKey.isPressed) mv.x -= 1;
                if (kb.dKey.isPressed) mv.x += 1;
            }
            gasInput = mv.y;
            steerInput = mv.x;

            // выйти — B / E
            if (kb != null && (kb.eKey.wasPressedThisFrame || kb.bKey.wasPressedThisFrame))
                Exit();
        }

        UpdateWheels();
        UpdateVisualWheels();
    }

    void FixedUpdate()
    {
        if (!occupied) return;
        float steer = steerInput * maxSteer;
        foreach (var w in steerWheels) w.steerAngle = steer;
        foreach (var w in driveWheels)
        {
            if (gasInput > 0.1f) { w.motorTorque = gasInput * motorTorque; w.brakeTorque = 0; }
            else if (gasInput < -0.1f) { w.brakeTorque = -gasInput * brakeTorque; w.motorTorque = 0; }
            else { w.motorTorque = 0; w.brakeTorque = 200f * (1 - Mathf.Abs(gasInput)); }
        }
    }

    void UpdateWheels() { }
    void UpdateVisualWheels()
    {
        for (int i = 0; i < wheelMeshes.Length && i < steerWheels.Length + driveWheels.Length; i++)
        {
            WheelCollider col = i < steerWheels.Length ? steerWheels[i] : driveWheels[i - steerWheels.Length];
            col.GetWorldPose(out var pos, out var rot);
            wheelMeshes[i].SetPositionAndRotation(pos, rot);
        }
    }

    void OnTriggerEnter(Collider other)
    {
        if (occupied) return;
        if (other.GetComponent<PlayerController>())
        {
            player = other.GetComponent<PlayerController>();
            // подсказка "E — сесть" — покажет UI
        }
    }

    public void Enter(PlayerController p)
    {
        occupied = true; player = p;
        p.EnterVehicle(seat);
    }
    public void Exit()
    {
        occupied = false;
        if (player) player.ExitVehicle(exitPoint.position);
        player = null;
    }
}
