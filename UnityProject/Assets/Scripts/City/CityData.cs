using UnityEngine;

public enum DistrictId { Beach, Casino, Downtown, Commercial, Residential }
public enum BuildingType { Bank, School, Casino, Club, Supermarket, Cafe, Shop, Hospital, Police, Gas, Garage, Office, Hotel, House, Pier }

[System.Serializable]
public struct Building
{
    public string id;
    public BuildingType type;
    public string name;
    public DistrictId district;
    public Vector2 pos; // x,z in meters (-500..500)
    public Vector2 size; // w,d
    public float height;
    public Color color;
    public Color glow; // neon, a=0 = none
    public float rotation;
}

[System.Serializable]
public struct Road
{
    public string id;
    public string name;
    public float width;
    public Vector2[] points;
}

public static class CityData
{
    public const float CITY_SIZE = 1000f;
    public const float HALF = 500f;

    public static readonly Building[] Buildings = new Building[]
    {
        new Building{id="pier", type=BuildingType.Pier, name="Vice Pier", district=DistrictId.Beach, pos=new Vector2(0,-460), size=new Vector2(14,80), height=4, color=new Color(0.91f,0.78f,0.62f)},
        new Building{id="beach-club", type=BuildingType.Club, name="Beach Club", district=DistrictId.Beach, pos=new Vector2(-180,-350), size=new Vector2(60,40), height=18, color=new Color(0.99f,0.90f,0.54f), glow=new Color(0.96f,0.62f,0.04f)},
        new Building{id="cafe-beach", type=BuildingType.Cafe, name="Beach Cafe", district=DistrictId.Beach, pos=new Vector2(180,-330), size=new Vector2(28,22), height=10, color=new Color(0.99f,0.94f,0.54f), glow=new Color(0.91f,0.70f,0f)},
        new Building{id="cafe-beach2", type=BuildingType.Cafe, name="Ocean View", district=DistrictId.Beach, pos=new Vector2(-80,-380), size=new Vector2(24,20), height=9, color=new Color(0.99f,0.97f,0.76f)},
        new Building{id="casino-diamond", type=BuildingType.Casino, name="Diamond Vice", district=DistrictId.Casino, pos=new Vector2(-340,80), size=new Vector2(80,70), height=42, color=new Color(0.12f,0.16f,0.21f), glow=new Color(0f,0.89f,1f)},
        new Building{id="casino-eclipse", type=BuildingType.Casino, name="Eclipse", district=DistrictId.Casino, pos=new Vector2(-330,-80), size=new Vector2(70,65), height=36, color=new Color(0.06f,0.09f,0.15f), glow=new Color(1f,0f,0.25f)},
        new Building{id="casino-star", type=BuildingType.Casino, name="Vice Star", district=DistrictId.Casino, pos=new Vector2(-320,-260), size=new Vector2(75,60), height=38, color=new Color(0.15f,0.15f,0.16f), glow=new Color(1f,0.84f,0f)},
        new Building{id="club-neon", type=BuildingType.Club, name="Neon Paradise", district=DistrictId.Casino, pos=new Vector2(-380,-10), size=new Vector2(45,35), height=20, color=new Color(0.24f,0.04f,0.35f), glow=new Color(1f,0f,1f)},
        new Building{id="club-nuit", type=BuildingType.Club, name="La Nuit", district=DistrictId.Casino, pos=new Vector2(-250,220), size=new Vector2(50,38), height=24, color=new Color(0.05f,0.09f,0.16f), glow=new Color(0.54f,0.36f,0.96f)},
        new Building{id="hotel-vespucci", type=BuildingType.Hotel, name="Hotel Vespucci", district=DistrictId.Casino, pos=new Vector2(-420,180), size=new Vector2(40,55), height=45, color=new Color(0.20f,0.25f,0.33f)},
        new Building{id="bank", type=BuildingType.Bank, name="Vice Mutual Bank", district=DistrictId.Downtown, pos=new Vector2(0,30), size=new Vector2(70,50), height=48, color=new Color(0.83f,0.78f,0.65f), glow=new Color(0.98f,0.80f,0.08f)},
        new Building{id="cityhall", type=BuildingType.Office, name="City Hall", district=DistrictId.Downtown, pos=new Vector2(80,160), size=new Vector2(60,45), height=34, color=new Color(0.61f,0.64f,0.69f)},
        new Building{id="office-1", type=BuildingType.Office, name="Vice Tower", district=DistrictId.Downtown, pos=new Vector2(-60,140), size=new Vector2(36,36), height=62, color=new Color(0.21f,0.74f,0.97f)},
        new Building{id="office-2", type=BuildingType.Office, name="Ocean Bank Tower", district=DistrictId.Downtown, pos=new Vector2(60,-40), size=new Vector2(32,32), height=55, color=new Color(0.05f,0.64f,0.91f)},
        new Building{id="police", type=BuildingType.Police, name="Полиция", district=DistrictId.Downtown, pos=new Vector2(-80,-40), size=new Vector2(42,34), height=18, color=new Color(0.11f,0.22f,0.54f)},
        new Building{id="super-vicemart", type=BuildingType.Supermarket, name="Vice Mart", district=DistrictId.Commercial, pos=new Vector2(340,40), size=new Vector2(90,70), height=16, color=new Color(0.86f,0.98f,0.90f)},
        new Building{id="super-247", type=BuildingType.Supermarket, name="24/7", district=DistrictId.Commercial, pos=new Vector2(380,260), size=new Vector2(55,40), height=14, color=new Color(0.73f,0.96f,0.81f)},
        new Building{id="shop-clothes1", type=BuildingType.Shop, name="Binco", district=DistrictId.Commercial, pos=new Vector2(280,-60), size=new Vector2(30,24), height=12, color=new Color(0.98f,0.64f,0.68f)},
        new Building{id="shop-clothes2", type=BuildingType.Shop, name="Sub Urban", district=DistrictId.Commercial, pos=new Vector2(320,-90), size=new Vector2(28,22), height=11, color=new Color(0.97f,0.65f,0.83f)},
        new Building{id="shop-electronics", type=BuildingType.Shop, name="Ammu-Nation", district=DistrictId.Commercial, pos=new Vector2(300,140), size=new Vector2(34,26), height=13, color=new Color(0.98f,0.74f,0.14f)},
        new Building{id="shop-barber", type=BuildingType.Shop, name="Barber", district=DistrictId.Commercial, pos=new Vector2(260,80), size=new Vector2(20,18), height=9, color=new Color(0.65f,0.95f,0.81f)},
        new Building{id="shop-tattoo", type=BuildingType.Shop, name="Tattoo", district=DistrictId.Commercial, pos=new Vector2(360,-10), size=new Vector2(20,18), height=9, color=new Color(0.86f,0.83f,0.99f)},
        new Building{id="shop-weapon", type=BuildingType.Shop, name="Gun Store", district=DistrictId.Commercial, pos=new Vector2(420,80), size=new Vector2(26,20), height=10, color=new Color(0.26f,0.25f,0.23f)},
        new Building{id="hospital", type=BuildingType.Hospital, name="Больница", district=DistrictId.Commercial, pos=new Vector2(400,-180), size=new Vector2(70,55), height=20, color=new Color(0.88f,0.94f,0.99f)},
        new Building{id="gas", type=BuildingType.Gas, name="Xero Gas", district=DistrictId.Commercial, pos=new Vector2(300,-220), size=new Vector2(40,32), height=10, color=new Color(0.99f,0.94f,0.54f)},
        new Building{id="school1", type=BuildingType.School, name="School No.1", district=DistrictId.Residential, pos=new Vector2(-220,420), size=new Vector2(85,60), height=22, color=new Color(0.99f,0.90f,0.54f)},
        new Building{id="school2", type=BuildingType.School, name="Vice Academy", district=DistrictId.Residential, pos=new Vector2(200,430), size=new Vector2(90,65), height=26, color=new Color(0.74f,0.85f,1f)},
        new Building{id="cafe-school", type=BuildingType.Cafe, name="Campus Cafe", district=DistrictId.Residential, pos=new Vector2(-40,380), size=new Vector2(26,20), height=10, color=new Color(0.99f,0.84f,0.66f)},
        new Building{id="cafe-park", type=BuildingType.Cafe, name="Park Cafe", district=DistrictId.Residential, pos=new Vector2(80,360), size=new Vector2(22,18), height=9, color=new Color(0.98f,0.73f,0.45f)},
        new Building{id="garage", type=BuildingType.Garage, name="Гараж игрока", district=DistrictId.Residential, pos=new Vector2(-120,440), size=new Vector2(36,26), height=10, color=new Color(0.26f,0.25f,0.23f)},
    };

    public static readonly Road[] Roads = new Road[]
    {
        new Road{id="coastal", name="Ocean Dr", width=10, points=new Vector2[]{ new(-500,-260), new(-300,-280), new(-100,-240), new(150,-260), new(400,-230), new(500,-240) }},
        new Road{id="vice-ave", name="Vice Ave", width=10, points=new Vector2[]{ new(-420,-200), new(-200,-50), new(0,30), new(180,120), new(340,200) }},
        new Road{id="sunset", name="Sunset Blvd", width=8, points=new Vector2[]{ new(-500,120), new(-200,140), new(0,180), new(200,200), new(500,180) }},
        new Road{id="central", name="Central Ave", width=10, points=new Vector2[]{ new(0,-500), new(0,500) }},
        new Road{id="commerce", name="Commerce St", width=9, points=new Vector2[]{ new(-500,0), new(500,0) }},
        new Road{id="highway", name="Highway Loop", width=14, points=new Vector2[]{ new(-480,-480), new(480,-480), new(480,480), new(-480,480), new(-480,-480) }},
        new Road{id="strip", name="Strip", width=8, points=new Vector2[]{ new(-350,-280), new(-350,260) }},
        new Road{id="school-st", name="School St", width=7, points=new Vector2[]{ new(-500,340), new(500,350) }},
        new Road{id="alley-1", name="Переулок", width=4, points=new Vector2[]{ new(-120,-120), new(-60,-80), new(-20,-40) }},
        new Road{id="alley-2", name="Переулок", width=4, points=new Vector2[]{ new(120,60), new(240,80) }},
        new Road{id="alley-3", name="Переулок", width=4, points=new Vector2[]{ new(-280,80), new(-180,60) }},
    };

    public struct VehicleSpawn { public string id; public string name; public Vector2 pos; public float rot; public string color; public float maxSpeed; }
    public static readonly VehicleSpawn[] Vehicles = new VehicleSpawn[]
    {
        new VehicleSpawn{id="v1", name="Sultan", pos=new Vector2(40,-20), rot=0.5f, color="#ef4444", maxSpeed=32},
        new VehicleSpawn{id="v2", name="Premier", pos=new Vector2(-100,60), rot=-1.2f, color="#3b82f6", maxSpeed=24},
        new VehicleSpawn{id="v3", name="Rancher", pos=new Vector2(280,10), rot=0, color="#22c55e", maxSpeed=22},
        new VehicleSpawn{id="v4", name="Faggio", pos=new Vector2(10,-320), rot=2f, color="#facc15", maxSpeed=18},
    };
}
