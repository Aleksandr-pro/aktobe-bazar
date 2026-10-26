using UnityEngine;
using TMPro;

/// <summary>
/// HUD: деньги, HP, звёзды, спидометр, подсказки.
/// </summary>
public class HUD : MonoBehaviour
{
    public TextMeshProUGUI moneyText;
    public TextMeshProUGUI healthText;
    public TextMeshProUGUI speedText;
    public TextMeshProUGUI wantedText;
    public TextMeshProUGUI hintText;
    public VehicleController vehicle;

    void Update()
    {
        if (GameManager.I)
        {
            if (moneyText) moneyText.text = "$" + GameManager.I.money.ToString("N0");
            if (healthText) healthText.text = "💚 " + GameManager.I.health + "%";
            if (wantedText) { wantedText.text = GameManager.I.wanted > 0 ? "★ " + GameManager.I.wanted : ""; wantedText.enabled = GameManager.I.wanted > 0; }
        }
        if (speedText && vehicle)
        {
            var rb = vehicle.GetComponent<Rigidbody>();
            float kmh = rb ? rb.linearVelocity.magnitude * 3.6f : 0;
            speedText.text = Mathf.RoundToInt(kmh) + " км/ч";
        }
    }

    public void ShowHint(string msg, float t = 2f) { if (hintText) { hintText.text = msg; CancelInvoke(nameof(ClearHint)); Invoke(nameof(ClearHint), t); } }
    void ClearHint() { if (hintText) hintText.text = ""; }
}
