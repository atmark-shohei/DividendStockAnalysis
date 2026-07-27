/**
 * ドメインエラー。`kind` で判別できる形にする（`.claude/CLAUDE.md`）。
 *
 * handler がこれを HTTP ステータスへ変換する。ドメイン層は HTTP を知らない。
 * メッセージ文字列ではなく `kind` で分岐させるのは、文言の変更が
 * 制御フローを壊さないようにするため。
 */
export type DomainError =
  /** スコアが 0〜10 の整数でない */
  | { readonly kind: 'ScoreOutOfRange'; readonly value: number }
  /** 銭として扱えない値（NaN / Infinity / 小数 / 安全整数の範囲外） */
  | { readonly kind: 'SenNotSafeInteger'; readonly value: number }
  /** 区分表が空 */
  | { readonly kind: 'ThresholdEmpty' }
  /** 区分表に穴または重複がある */
  | {
      readonly kind: 'ThresholdNotAscending';
      readonly lowerPoints: number;
      readonly lowerMax: number | null;
      readonly upperPoints: number;
      readonly upperMin: number | null;
    }
  /** 最上位区分に上限がある（「下限以上」で開いている必要がある） */
  | { readonly kind: 'ThresholdTopBounded'; readonly maxExclusive: number };

/**
 * ログ・テスト向けの短い説明。**画面には出さない**。
 *
 * ユーザー向けメッセージは handler が `kind` を見て組み立てる。
 * ドメイン層に日本語の UI 文言を持たせると、表示の都合でドメインが動く。
 */
export function describeDomainError(error: DomainError): string {
  switch (error.kind) {
    case 'ScoreOutOfRange':
      return `score out of range: ${error.value}`;
    case 'SenNotSafeInteger':
      return `not a safe integer sen value: ${error.value}`;
    case 'ThresholdEmpty':
      return 'score band table is empty';
    case 'ThresholdNotAscending':
      return `gap or overlap between ${error.lowerPoints}pt (max=${String(error.lowerMax)}) and ${error.upperPoints}pt (min=${String(error.upperMin)})`;
    case 'ThresholdTopBounded':
      return `top band must be open-ended but has maxExclusive=${error.maxExclusive}`;
  }
}
