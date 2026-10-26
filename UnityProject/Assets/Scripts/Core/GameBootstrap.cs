using UnityEngine;

/// <summary>
/// Точка входа 1×1 км. Ставит настройки под Galaxy A15 и готовит ARM ASR.
/// Порядок: CityBuilder.Rebuild() → SpawnPlayer → SpawnTraffic → ArmAsrManager.ApplyQualityForA15()
/// </summary>
public class GameBootstrap : MonoBehaviour
{
    public CityBuilder cityBuilder;
    public ArmAsrManager armAsr;
    public TrafficSystem traffic;
    public Transform playerSpawn;

    [Header("Android Optimization (A15)")]
    public bool applyA15DefaultsOnStart = true;

    void Awake()
    {
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = 60;
        // Vulkan — обязателен для ARM ASR (в ProjectSettings → Graphics API)
        Debug.Log("[Bootstrap] Vice City 1×1 км — старт, размер 1000×1000, 28 зданий, 5 районов");
    }

    void Start()
    {
        if (cityBuilder) cityBuilder.Rebuild();
        if (playerSpawn) Debug.Log($"[Bootstrap] Спавн игрока: {playerSpawn.position}");
        if (applyA15DefaultsOnStart && armAsr) armAsr.ApplyQualityForA15();
        Debug.Log("[Bootstrap] Готов к игре. ARM ASR подключится когда соберем плагин — сейчас заглушка, игра уже играбельна без него.");
    }

#if UNITY_EDITOR
    [ContextMenu("Teleport to Casino")]
    void TeleportToCasino() => FindFirstObjectByType<PlayerController>()?.transform.SetPositionAndRotation(new Vector3(-340, 1, 80), Quaternion.identity);
    [ContextMenu("Teleport to Beach")]
    void TeleportToBeach() => FindFirstObjectByType<PlayerController>()?.transform.SetPositionAndRotation(new Vector3(0, 1, -460), Quaternion.identity);
#endif
}
