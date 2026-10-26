using UnityEngine;

/// <summary>
/// Менеджер районов 1×1 км. Каждый район — свой стиль материалов, плотность, LOD.
/// Beach / CasinoRow / Downtown / Commercial / Residential
/// </summary>
public class DistrictManager : MonoBehaviour
{
    public enum District { Beach, CasinoRow, Downtown, Commercial, Residential }

    [System.Serializable]
    public struct DistrictConfig
    {
        public District district;
        public Color groundColor;
        public Material buildingMaterial;
        public float density; // 0.5 beach, 1.0 downtown
        [Range(0, 2)] public float lodBias;
    }

    public DistrictConfig[] districts = new DistrictConfig[5];

    void Awake()
    {
        // Автонастройка: Beach = теплый песок, Casino = неон, Downtown = стекло
        districts[0] = new DistrictConfig { district = District.Beach, groundColor = new Color(0.85f,0.76f,0.62f), density = 0.6f, lodBias = 1.2f };
        districts[1] = new DistrictConfig { district = District.CasinoRow, groundColor = new Color(0.12f,0.12f,0.14f), density = 0.9f, lodBias = 0.9f };
        districts[2] = new DistrictConfig { district = District.Downtown, groundColor = new Color(0.18f,0.18f,0.20f), density = 1.0f, lodBias = 1.0f };
        districts[3] = new DistrictConfig { district = District.Commercial, groundColor = new Color(0.20f,0.20f,0.22f), density = 0.8f, lodBias = 1.1f };
        districts[4] = new DistrictConfig { district = District.Residential, groundColor = new Color(0.25f,0.27f,0.25f), density = 0.7f, lodBias = 1.3f };
    }

    public District GetDistrict(Vector2 pos)
    {
        if (pos.y < -200) return District.Beach;
        if (pos.x < -150 && pos.y >= -200 && pos.y < 300) return District.CasinoRow;
        if (pos.x >= -150 && pos.x < 200 && pos.y >= -200 && pos.y < 300) return District.Downtown;
        if (pos.x >= 200 && pos.y >= -300 && pos.y < 300) return District.Commercial;
        return District.Residential;
    }
}
