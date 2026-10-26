using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// 3-е лицо: левый стик — движение, правый свайп — камера (Cinemachine FreeLook), бег, прыжок.
/// Потом 1-е лицо: переключить Cinemachine на FirstPerson.
/// На A15 — CharacterController (без Rigidbody), гравитация 20.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class PlayerController : MonoBehaviour
{
    public float walkSpeed = 6f;
    public float runSpeed = 11f;
    public float jumpHeight = 1.2f;
    public Transform camYaw; // горизонтальный риг камеры

    CharacterController cc;
    Vector3 vel;
    bool isRunning;
    float yaw;

    public bool inVehicle;

    void Awake() => cc = GetComponent<CharacterController>();

    void Update()
    {
        if (inVehicle) return;

        // Input System — Gamepad + Touch
        Vector2 move = Vector2.zero;
        if (Gamepad.current != null) move = Gamepad.current.leftStick.ReadValue();
        // также WASD для теста в редакторе
        if (Keyboard.current != null)
        {
            if (Keyboard.current.wKey.isPressed) move.y += 1;
            if (Keyboard.current.sKey.isPressed) move.y -= 1;
            if (Keyboard.current.aKey.isPressed) move.x -= 1;
            if (Keyboard.current.dKey.isPressed) move.x += 1;
        }
        isRunning = (Gamepad.current != null && Gamepad.current.rightShoulder.isPressed) || (Keyboard.current != null && Keyboard.current.shiftKey.isPressed);

        float speed = isRunning ? runSpeed : walkSpeed;
        Vector3 input = new Vector3(move.x, 0, move.y);
        if (input.magnitude > 0.1f)
        {
            // движение относительно камеры
            float camYawAngle = camYaw ? camYaw.eulerAngles.y : 0;
            Quaternion yawRot = Quaternion.Euler(0, camYawAngle, 0);
            Vector3 dir = yawRot * input.normalized;
            cc.Move(dir * speed * Time.deltaTime);
            // поворот персонажа
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), 12 * Time.deltaTime);
        }

        // гравитация + прыжок
        bool grounded = cc.isGrounded;
        if (grounded && vel.y < 0) vel.y = -2f;
        if (grounded && Keyboard.current != null && Keyboard.current.spaceKey.wasPressedThisFrame)
            vel.y = Mathf.Sqrt(jumpHeight * 2 * 20f);
        vel.y -= 20f * Time.deltaTime;
        cc.Move(vel * Time.deltaTime);

        // границы города
        var p = transform.position;
        p.x = Mathf.Clamp(p.x, -490, 490);
        p.z = Mathf.Clamp(p.z, -490, 490);
        transform.position = p;
    }

    public void EnterVehicle(Transform seat)
    {
        inVehicle = true;
        cc.enabled = false;
        transform.SetParent(seat);
        transform.localPosition = Vector3.zero;
        transform.localRotation = Quaternion.identity;
        gameObject.SetActive(false);
    }
    public void ExitVehicle(Vector3 pos)
    {
        inVehicle = false;
        transform.SetParent(null);
        transform.position = pos;
        cc.enabled = true;
        gameObject.SetActive(true);
    }
}
