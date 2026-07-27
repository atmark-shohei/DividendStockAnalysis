/**
 * 株価入力欄のパース。
 *
 * 仕様: `docs/02_design/logic/dividend-yield-scoring.md` §3.1
 * 「数値のみ入力可能。初期値は空」「全角数字は半角に正規化する」
 */

/** 全角の英数記号（U+FF01〜U+FF5E）と半角（U+0021〜U+007E）のオフセット */
const FULLWIDTH_OFFSET = 0xfee0;

/**
 * 3桁区切りとして妥当な形だけを通す。
 * カンマを無検証で除去すると `12,3` が `123`（＝123円）として通ってしまい、
 * `12.3` の打ち間違いが**10倍の桁ずれ**のまま検証を素通りする
 * （`.claude/rules/backend.md`「桁（株価が10倍ずれる）」）。
 */
const PRICE_PATTERN = /^-?(\d+|[1-9]\d{0,2}(,\d{3})+)(\.\d{1,2})?$/;

export type PriceInputResult =
  /** 未入力。画面は「株価を入力してください」 */
  | { readonly kind: 'empty' }
  /** 数値として読めない。画面は「株価が不正です」 */
  | { readonly kind: 'invalid' }
  /** 銭単位の整数。0 や負も含む（妥当性の判定はスコア側の責務） */
  | { readonly kind: 'ok'; readonly sen: number };

/**
 * 入力文字列を銭単位の整数に変換する。1 円 = 100 銭。
 *
 * **0 や負の妥当性はここで判定しない。** それはスコア側の責務で、
 * `calculateDividendYield` が「株価が 0 です」「株価が不正です」を区別する（§4）。
 * ここで 0 に丸めたり弾いたりすると、その区別が潰れる。
 *
 * 一方で「未入力」と「読めない文字列」は**ここでしか区別できない**ので、
 * 戻り値を判別可能ユニオンにしてある。両方を `null` で返すと、
 * `abc` と入力したユーザーに「株価を入力してください」と誤表示される。
 */
export function parsePriceInput(raw: string): PriceInputResult {
  const normalized = raw
    // 全角英数記号を半角へ。日本語環境では全角数字が日常的に混入する
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/　/g, ' ') // 全角スペース
    .replace(/−/g, '-') // U+2212 MINUS SIGN。IME が半角ハイフンの代わりに出す
    .trim();

  if (normalized === '') return { kind: 'empty' };

  // 形式検証はカンマを除去する**前**に行う。除去してからでは区切り位置を検証できない。
  // 小数第2位まで＝1銭単位。第3位以下を許すと銭未満が黙って切り捨てられ利回りがずれる。
  if (!PRICE_PATTERN.test(normalized)) return { kind: 'invalid' };

  const withoutSeparators = normalized.replace(/,/g, '');
  const isNegative = withoutSeparators.startsWith('-');
  const digits = isNegative ? withoutSeparators.slice(1) : withoutSeparators;
  const [integerPart = '0', fractionPart = ''] = digits.split('.');

  // 文字列のまま銭へ持ち上げる。parseFloat してから 100 倍すると誤差が出る
  const magnitude = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, '0'));

  // 桁を打ち間違えた入力が非整数のまま下流に流れると、整数比較の前提が崩れる
  if (!Number.isSafeInteger(magnitude)) return { kind: 'invalid' };

  // `-0` を返さない。`Object.is(-0, 0)` は false なので比較で事故る
  if (magnitude === 0) return { kind: 'ok', sen: 0 };

  return { kind: 'ok', sen: isNegative ? -magnitude : magnitude };
}
