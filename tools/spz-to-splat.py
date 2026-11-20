#!/usr/bin/env python3
"""SPZ (версия 3, gzip) -> .splat (antimatter15), 32 байта на сплат.

Зачем: библиотека gaussian-splats-3d 0.4.7 понимает только SPZ версий 1-2,
а файл от Niantic-Scene имеет версию 3 (кватернион «smallest three» в 4 байтах).

Раскладка SPZ v3 (внутри одного gzip-потока), 20 байт на точку:
  заголовок 16 байт: magic 0x5053474e, version u32, numPoints u32,
                     shDegree u8, fractionalBits u8, flags u8, reserved u8
  positions : numPoints * 9   (3 x int24, fixed point)
  alphas    : numPoints * 1
  colors    : numPoints * 3
  scales    : numPoints * 3
  rotations : numPoints * 4   (uint32, smallest-three)
  sh        : numPoints * 3 * dim  (если shDegree > 0)
"""
import gzip
import struct
import sys

import numpy as np

COLOR_SCALE = 0.28209479177387814
SQRT1_2 = float(np.sqrt(0.5))


def decode_rotation(rot_bytes, n):
    """uint32 smallest-three -> кватернион xyzw (float32)."""
    comp = np.frombuffer(rot_bytes, dtype=np.uint8).reshape(n, 4).astype(np.uint32)
    comp = comp[:, 0] | (comp[:, 1] << 8) | (comp[:, 2] << 16) | (comp[:, 3] << 24)

    largest = (comp >> 30) & 3
    payload = comp & 0x3FFFFFFF

    splits = np.stack([(payload >> 0) & 1023, (payload >> 10) & 1023,
                       (payload >> 20) & 1023], axis=1).astype(np.float32)
    negs = np.stack([(payload >> 9) & 1, (payload >> 19) & 1,
                     (payload >> 29) & 1], axis=1).astype(np.float32)

    order = np.tile(np.array([3, 2, 1, 0], dtype=np.int32), (n, 1))
    keep = order != largest[:, None]
    # packing дописывает компоненты по возрастанию i со сдвигом влево -> в МЛАДШИХ
    # битах лежит последняя дописанная пара, т.е. компонент с НАИБОЛЬШИМ индексом
    i_for_k = order[keep].reshape(n, 3)

    q = np.zeros((n, 4), dtype=np.float32)
    vals = (SQRT1_2 * splits / 1023.0) * (1.0 - 2.0 * negs)
    rows = np.arange(n)[:, None]
    q[rows, i_for_k] = vals
    rest = np.clip(1.0 - np.sum(vals * vals, axis=1), 0.0, 1.0)
    q[rows[:, 0], largest] = np.sqrt(rest)
    return q  # x, y, z, w


def main(src, dst):
    raw = open(src, 'rb').read()
    data = gzip.decompress(raw)
    magic, version, n, sh_deg, frac_bits, flags, _res = struct.unpack('<IIIBBBB', data[:16])
    if magic != 0x5053474E:
        raise SystemExit(f'не SPZ: magic {magic:#x}')
    print(f'версия {version}, точек {n}, SH {sh_deg}, fractionalBits {frac_bits}, флаги {flags:#x}')

    rot_bpp = 4 if version >= 3 else 3
    pos_bpp = 4 if version == 1 else 9
    sh_dim = (sh_deg + 1) ** 2 - 1
    need = 16 + n * (pos_bpp + 1 + 3 + 3 + rot_bpp + sh_dim * 3)
    if len(data) != need:
        raise SystemExit(f'размер не совпал: получено {len(data)}, ожидалось {need}')

    off = 16
    pos = np.frombuffer(data, dtype=np.uint8, count=n * pos_bpp, offset=off).reshape(n, 3, 3)
    off += n * pos_bpp
    alpha = np.frombuffer(data, dtype=np.uint8, count=n, offset=off)
    off += n
    color = np.frombuffer(data, dtype=np.uint8, count=n * 3, offset=off).reshape(n, 3)
    off += n * 3
    scale = np.frombuffer(data, dtype=np.uint8, count=n * 3, offset=off).reshape(n, 3)
    off += n * 3
    rot = data[off:off + n * rot_bpp]

    # 24-битные знаковые координаты
    fixed = (pos[:, :, 0].astype(np.int32)
             | (pos[:, :, 1].astype(np.int32) << 8)
             | (pos[:, :, 2].astype(np.int32) << 16))
    fixed = np.where(fixed & 0x800000, fixed - (1 << 24), fixed)
    xyz = fixed.astype(np.float32) / float(1 << frac_bits)

    lin_scale = np.exp(scale.astype(np.float32) / 16.0 - 10.0)

    q = decode_rotation(rot, n)  # xyzw

    floats = np.ascontiguousarray(np.concatenate([xyz, lin_scale], axis=1), dtype=np.float32)

    # цвет RGBA: в .splat те же байты, что в SPZ (0.5 + C0*f_dc)
    rgba = np.concatenate([color, alpha[:, None]], axis=1).astype(np.uint8)
    rot_bytes = np.clip(np.round(np.stack([q[:, 3], q[:, 0], q[:, 1], q[:, 2]], axis=1) * 128.0 + 128.0),
                        0, 255).astype(np.uint8)

    body = np.zeros((n, 32), dtype=np.uint8)
    body[:, 0:24] = floats.view(np.uint8).reshape(n, 24)
    body[:, 24:28] = rgba
    body[:, 28:32] = rot_bytes

    open(dst, 'wb').write(body.tobytes())
    print(f'записано {dst}: {n} сплатов, {n * 32 / 1e6:.1f} МБ')

    # контрольные цифры
    print('  границы:', xyz.min(axis=0), '…', xyz.max(axis=0))
    print('  размер (м):', (xyz.max(axis=0) - xyz.min(axis=0)))
    print('  альфа p50/p90:', np.percentile(alpha, 50), np.percentile(alpha, 90))
    print('  средний цвет:', color.mean(axis=0))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
