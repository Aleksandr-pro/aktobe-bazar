using UnityEngine;

/// <summary>
/// Синглтон состояния: деньги, здоровье, розыск, машина.
/// </summary>
public class GameManager : MonoBehaviour
{
    public static GameManager I;
    [Header("Player")]
    public int money = 5000;
    public int health = 100;
    public int wanted = 0;
    [Header("Graphics")]
    public bool aemEnabled = true;
    public enum Quality { Low, Medium, High }
    public Quality quality = Quality.Medium; // Medium = A15

    void Awake() { I = this; DontDestroyOnLoad(gameObject); }

    public void AddMoney(int v) { money += v; }
    public void AddWanted(int v) { wanted = Mathf.Clamp(wanted + v, 0, 5); }
}
