using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

/// <summary>
/// Спавнит весь город 1x1 км из CityData. Вешается на пустой GameObject "City".
/// В редакторе: City → Rebuild City. На телефоне — Addressables подменяют боксы на AAA префабы.
/// </summary>
public class CityBuilder : MonoBehaviour
{
    public Material roadMaterial;
    public Material groundMaterial;
    public Material oceanMaterial;
    public Material sandMaterial;

    [Header("Префабы (опционально — если пусто, генерит боксы)")]
    public GameObject buildingPrefab;
    public GameObject roadPrefab;

    void Start() => Rebuild();

    [ContextMenu("Rebuild City")]
    public void Rebuild()
    {
        // чистим
        for (int i = transform.childCount - 1; i >= 0; i--) DestroyImmediate(transform.GetChild(i).gameObject);

        BuildGround();
        BuildRoads();
        BuildBuildings();
        BuildDeco();
    }

    void BuildGround()
    {
        CreatePlane("Ground", new Vector3(0, 0, 0), new Vector2(1000, 1000), groundMaterial, 0);
        CreatePlane("Sand", new Vector3(0, 0.02f, -360), new Vector2(1000, 280), sandMaterial, 0);
        CreatePlane("Ocean", new Vector3(0, -0.2f, -620), new Vector2(1200, 260), oceanMaterial, -1);
        // roundabout
        var rb = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        rb.name = "Roundabout";
        rb.transform.SetParent(transform);
        rb.transform.position = new Vector3(0, 0.06f, 30);
        rb.transform.localScale = new Vector3(28, 0.1f, 28);
    }

    void BuildRoads()
    {
        foreach (var r in CityData.Roads)
        {
            for (int i = 0; i < r.points.Length - 1; i++)
            {
                var a = r.points[i]; var b = r.points[i + 1];
                var dir = (b - a).normalized;
                var perp = new Vector2(-dir.y, dir.x) * (r.width * 0.5f);
                var center = (a + b) * 0.5f;
                var len = Vector2.Distance(a, b);
                var ang = Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = r.name + "_" + i;
                go.transform.SetParent(transform);
                go.transform.position = new Vector3(center.x, 0.05f, center.y);
                go.transform.localScale = new Vector3(len, 0.1f, r.width);
                go.transform.eulerAngles = new Vector3(0, -ang, 0);
                if (roadMaterial) go.GetComponent<Renderer>().sharedMaterial = roadMaterial;
            }
        }
    }

    void BuildBuildings()
    {
        foreach (var b in CityData.Buildings)
        {
            GameObject go;
            if (buildingPrefab)
                go = Instantiate(buildingPrefab, transform);
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.transform.SetParent(transform);
            }
            go.name = b.id + " — " + b.name;
            go.transform.position = new Vector3(b.pos.x, b.height * 0.5f, b.pos.y);
            go.transform.localScale = new Vector3(b.size.x, b.height, b.size.y);
            go.transform.eulerAngles = new Vector3(0, b.rotation, 0);
            var rend = go.GetComponent<Renderer>();
            if (rend)
            {
                var m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                m.color = b.color;
                m.SetFloat("_Smoothness", 0.15f);
                rend.sharedMaterial = m;
                if (b.glow.a > 0.01f)
                {
                    // неон — добавим точечный свет
                    var light = new GameObject("Neon").transform;
                    light.SetParent(go.transform);
                    light.localPosition = Vector3.up * 0.5f;
                    var pl = light.gameObject.AddComponent<Light>();
                    pl.type = LightType.Point;
                    pl.color = b.glow;
                    pl.intensity = 12;
                    pl.range = 60;
                }
            }
            // коллайдер уже от Cube, для префаба — BoxCollider
            go.tag = "Building";
        }
    }

    void BuildDeco()
    {
        // пальмы вдоль пляжа — GPU instancing (18 шт)
        for (int i = 0; i < 18; i++)
        {
            float x = -460 + i * 52 + (i % 3 == 0 ? 12 : 0);
            float z = -310 - (i % 2) * 18;
            var palm = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            palm.name = "Palm_" + i;
            palm.transform.SetParent(transform);
            palm.transform.position = new Vector3(x, 6, z);
            palm.transform.localScale = new Vector3(0.6f, 6, 0.6f);
        }
    }

    GameObject CreatePlane(string name, Vector3 pos, Vector2 size, Material mat, int layer)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
        go.name = name;
        go.transform.SetParent(transform);
        go.transform.position = pos;
        go.transform.localScale = new Vector3(size.x / 10f, 1, size.y / 10f);
        if (mat) go.GetComponent<Renderer>().sharedMaterial = mat;
        return go;
    }
}
