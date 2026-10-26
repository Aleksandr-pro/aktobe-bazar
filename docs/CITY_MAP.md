# Карта Vice City Mini 1×1 км — координаты

Центр 0,0. Границы -500 .. 500. Север +Z, восток +X. Все в метрах.

## Визуально (снизу — пляж)
```
          Residential  y 300..500
  -------------------------------------------------
  |  School No.1  (-220,420)   Park   Vice Academy (200,430) |
  |  Дом -380,360        Campus Cafe -40,380                |
  |                Гараж игрока -120,440                     |
  -------------------------------------------------
  | Casino Row (-500..-150) | Downtown (-150..200) | Commercial (200..500) |
  | Diamond (-340,80)       | Bank (0,30)          | Vice Mart (340,40)   |
  | Eclipse (-330,-80)      | City Hall (80,160)   | Binco (280,-60)      |
  | Vice Star (-320,-260)   | Vice Tower (-60,140) | 24/7 (380,260)       |
  | Neon Paradise (-380,-10)| Police (-80,-40)     | Hospital (400,-180)  |
  | La Nuit (-250,220)      | Кольцо (0,30)        | Xero Gas (300,-220)  |
  -------------------------------------------------
          Beach y -500..-200
  | Beach Club -180,-350 | Pier 0,-460 | Beach Cafe 180,-330 |
  |           Coastal Hwy S-изгиб (-500,-260 → 500,-240)     |
  |                    Океан y -620                          |
```

## Дороги (полилинии, ширина м)
- Ocean Dr 10м: (-500,-260)→(-300,-280)→(-100,-240)→(150,-260)→(400,-230)→(500,-240)
- Vice Ave 10м диагональ: (-420,-200)→(-200,-50)→(0,30)→(180,120)→(340,200)
- Sunset 8м: (-500,120)→(-200,140)→(0,180)→(200,200)→(500,180)
- Central Ave 10м: (0,-500)→(0,500) вертикаль
- Commerce 9м: (-500,0)→(500,0) горизонталь
- Highway Loop 14м: квадрат -480..480
- Strip 8м: (-350,-280)→(-350,260) казино улица
- School St 7м: (-500,340)→(500,350)
- Переулки 4м: (-120,-120)→(-20,-40), (120,60)→(240,80), (-280,80)→(-180,60)

## Здания — полный список (28)
| # | id | тип | имя | x | z | w | d | h | район |
|---|----|-----|-----|---|---|---|---|---|-------|
|1|pier|pier|Vice Pier|0|-460|14|80|4|beach|
|2|beach-club|club|Beach Club|-180|-350|60|40|18|beach|
|3|cafe-beach|cafe|Beach Cafe|180|-330|28|22|10|beach|
|4|cafe-beach2|cafe|Ocean View|-80|-380|24|20|9|beach|
|5|casino-diamond|casino|Diamond Vice|-340|80|80|70|42|casino|
|6|casino-eclipse|casino|Eclipse|-330|-80|70|65|36|casino|
|7|casino-star|casino|Vice Star|-320|-260|75|60|38|casino|
|8|club-neon|club|Neon Paradise|-380|-10|45|35|20|casino|
|9|club-nuit|club|La Nuit|-250|220|50|38|24|casino|
|10|hotel-vespucci|hotel|Hotel Vespucci|-420|180|40|55|45|casino|
|11|bank|bank|Vice Mutual Bank|0|30|70|50|48|downtown|
|12|cityhall|office|City Hall|80|160|60|45|34|downtown|
|13|office-1|office|Vice Tower|-60|140|36|36|62|downtown|
|14|office-2|office|Ocean Bank|-60|-40? 60,-40|32|32|55|downtown|
|15|police|police|Полиция|-80|-40|42|34|18|downtown|
|16|super-vicemart|super|Vice Mart|340|40|90|70|16|commercial|
|17|super-247|super|24/7|380|260|55|40|14|commercial|
|18|shop-clothes1|shop|Binco|280|-60|30|24|12|commercial|
|19|shop-clothes2|shop|Sub Urban|320|-90|28|22|11|commercial|
|20|shop-electronics|shop|Ammu-Nation|300|140|34|26|13|commercial|
|21|shop-barber|shop|Barber|260|80|20|18|9|commercial|
|22|shop-tattoo|shop|Tattoo|360|-10|20|18|9|commercial|
|23|shop-weapon|shop|Gun Store|420|80|26|20|10|commercial|
|24|hospital|hospital|Больница|400|-180|70|55|20|commercial|
|25|gas|gas|Xero Gas|300|-220|40|32|10|commercial|
|26|school1|school|School No.1|-220|420|85|60|22|residential|
|27|school2|school|Vice Academy|200|430|90|65|26|residential|
|28|garage|garage|Гараж|-120|440|36|26|10|residential|
+ кафе: Campus -40,380, Park 80,360 + дома -380,360 / -320,400 / 340,380

## Машины спавн (4)
- Sultan спорт красный 40,-20
- Premier седан синий -100,60
- Rancher внедорожник зелёный 280,10
- Faggio скутер жёлтый 10,-320 (у пляжа)

Эти координаты уже в `CityData.cs` — CityBuilder спавнит по ним.
