/**
 * 総合点・指標別スコアの進捗バー（`docs/02_design/ui/components.md` §2 `<ScoreBar>`）。
 *
 * 塗りは常に `--color-data`（中立グレー）。**緑・赤は使わない**
 * （`docs/02_design/ui/design-tokens.md` §2.2「スコアに緑・赤を使わない」）。
 */

/**
 * `value`/`max` の割合（0〜100 にクランプ）。`max` が 0 以下ならゼロ除算を避けて 0 を返す
 * （呼び出し側にパーセント計算をさせない。`components.md` §2 の設計）。
 */
export function scoreBarPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  const percent = (value / max) * 100;
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

export function ScoreBar({
  value,
  max,
  width,
}: {
  readonly value: number;
  readonly max: number;
  /** 既定は `100%`。検索一覧の hero だけ固定幅（`components.md` §2） */
  readonly width?: string;
}) {
  const percent = scoreBarPercent(value, max);
  return (
    // 数値は隣接する text ノード側で読み上げるため、バー自体は装飾として隠す
    <span className="score-bar" style={{ width: width ?? '100%' }} aria-hidden="true">
      <span className="score-bar-track">
        <span className="score-bar-fill" style={{ width: `${String(percent)}%` }} />
      </span>
    </span>
  );
}
