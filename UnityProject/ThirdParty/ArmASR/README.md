# Arm ASR Generic Library — сюда клонировать

```bash
cd UnityProject/ThirdParty/ArmASR
git clone https://github.com/arm/accuracy-super-resolution-generic-library.git .
# или
git clone https://github.com/arm/accuracy-super-resolution.git ../accuracy-super-resolution
```

Лицензия MIT. После клона:
- Arm_ASR/include/host/ffxm_fsr2.h
- Arm_ASR/src/backends/shared/blob_accessors/prebuilt_shaders

Далее смотри docs/ARM_ASR_GUIDE.md (Tight Integration для Unity URP).

Unity плагин от Arm ещё в разработке (обещан 2025), поэтому юзаем Generic Library + Vulkan backend.
