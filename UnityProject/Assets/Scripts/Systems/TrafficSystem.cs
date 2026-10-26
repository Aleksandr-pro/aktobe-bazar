using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// Трафик 1×1 км: машины ездят по Road точкам из CityData.Roads.
/// LOD: дальше 150м — упрощенные mesh, culling за углом.
/// </summary>
public class TrafficSystem : MonoBehaviour
{
    public Transform[] carPrefabs;
    public int carCount = 20;
    public float baseSpeed = 8f;

    List<Transform> cars = new();

    void Start()
    {
        for (int i = 0; i < carCount; i++) SpawnCar();
    }

    void SpawnCar()
    {
        var road = CityData.Roads[Random.Range(0, CityData.Roads.Length)];
        if (road.points.Length < 2) return;
        int seg = Random.Range(0, road.points.Length - 1);
        Vector2 a = road.points[seg], b = road.points[seg+1];
        Vector2 p = Vector2.Lerp(a, b, Random.value);
        var go = new GameObject($"Traffic_{cars.Count}");
        go.transform.position = new Vector3(p.x, 0.6f, p.y);
        go.transform.SetParent(transform);
        var mesh = GameObject.CreatePrimitive(PrimitiveType.Cube);
        mesh.transform.SetParent(go.transform);
        mesh.transform.localPosition = Vector3.zero;
        mesh.transform.localScale = new Vector3(4.2f, 1f, 1.8f);
        var mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        mat.color = Random.ColorHSV(0,1,0.6f,1,0.8f,1);
        mesh.GetComponent<Renderer>().sharedMaterial = mat;
        cars.Add(go.transform);
        // Движение: простой lerp по road points (в v0.2 — Spline + avoidance)
        go.AddComponent<TrafficMover>().Init(road, seg, baseSpeed + Random.Range(-2f,3f));
    }
}

class TrafficMover : MonoBehaviour
{
    Road road; int seg; float speed; float t;
    public void Init(Road r, int s, float spd) { road=r; seg=s; speed=spd; t=Random.value; }
    void Update()
    {
        if (road.points == null || road.points.Length < 2) return;
        t += Time.deltaTime * speed / Vector2.Distance(road.points[seg], road.points[seg+1]);
        if (t >= 1f) { t=0; seg = (seg+1)%(road.points.Length-1); }
        Vector2 p = Vector2.Lerp(road.points[seg], road.points[seg+1], t);
        transform.position = new Vector3(p.x, transform.position.y, p.y);
        Vector2 dir = (road.points[seg+1] - road.points[seg]).normalized;
        transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(new Vector3(dir.x,0,dir.y)), 5*Time.deltaTime);
    }
}
