import { describe, expect, it } from 'vitest';

/**
 * PBKDF2 のイテレーション数を決めるための実測（T-063）。
 *
 * **実測専用テストであり、CI の合否判定には使わない**（下限アサーションは
 * 「異常に遅くなっていないか」の桁違いチェックのみ）。目的は
 * `console.log` に出る実測値を [ADR-0013](../../docs/adr/0013-multi-user-auth-small-scale.md)
 * §決定3 の「イテレーション数は実測して決める」に反映すること。
 *
 * workerd（miniflare 経由）上で `crypto.subtle.deriveBits` を実行し、
 * Workers の CPU 時間制限に対してどのイテレーション数まで許容できるかを見る。
 * 計測は `performance.now()` の壁時計時間。PBKDF2 は同期的な CPU バウンド処理で
 * I/O 待ちが無いため、壁時計時間は Workers の CPU 時間とほぼ一致する近似値になる
 * （完全な一致の保証ではない。真の CPU 時間は Cloudflare の実行環境でしか測れない）。
 */

async function deriveBitsMs(password: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const start = performance.now();
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  );
  return performance.now() - start;
}

describe('PBKDF2 イテレーション数の実測（T-063）', () => {
  // OWASP Password Storage Cheat Sheet (2023) が PBKDF2-HMAC-SHA256 に挙げる代表値。
  // 210,000 が最小推奨、600,000 が推奨値
  const candidates = [10_000, 50_000, 100_000, 210_000, 310_000, 600_000];

  it.each(candidates)('iterations=%i の所要時間を計測する', async (iterations) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    // ウォームアップ1回（JITの影響を減らす）+ 3回計測して中央値を使う
    await deriveBitsMs('warmup-password', salt, iterations);
    const samples: [number, number, number] = [
      await deriveBitsMs('correct horse battery staple', salt, iterations),
      await deriveBitsMs('correct horse battery staple', salt, iterations),
      await deriveBitsMs('correct horse battery staple', salt, iterations),
    ];
    samples.sort((a, b) => a - b);
    const medianMs = samples[1];

    // 実測値を人間が読むための意図的なログ
    const sampleText = samples.map((s) => s.toFixed(2)).join(',');
    console.log(
      `[PBKDF2] iterations=${String(iterations)} median=${medianMs.toFixed(2)}ms samples=${sampleText}`,
    );

    // 桁違いの異常（無限ループ化等）だけを検出する。しきい値は実行環境の
    // CPU 制限そのものではない（実測値そのものが目的で、ここでは落とさない）
    expect(medianMs).toBeLessThan(10_000);
  });
});
