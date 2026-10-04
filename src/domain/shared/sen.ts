/**
 * 銭。金額の最小単位で、1 円 = 100 銭（`CLAUDE.md`）。
 *
 * **金額計算に浮動小数点を使わない。** 配当利回りや取得単価の誤差はそのまま
 * 投資判断の誤りになるため、金額は必ずこの整数で持ち回る。
 *
 * `type Sen = number` の別名では円と銭の取り違えを型が見逃す（`todo-list.md` T-048）。
 * branded type にして、生の `number` からは `createSen` を通さないと作れないようにする。
 */

import { type DomainError } from './domain-error';
import { type Result, err, ok } from './result';

export type Sen = number & { readonly __brand: 'Sen' };

/**
 * 銭として扱える値か。
 *
 * これを通さないと `NaN` が比較のガードをすべて素通りする。`NaN < 0` も `NaN >= 0` も
 * false なので、素朴に書くと判定不能ではなく**最高点**に落ちる。壊れたデータが
 * 満点を取るのが最悪の壊れ方なので、入口で止める。
 */
export function isSen(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function createSen(value: number): Result<Sen, DomainError> {
  if (!isSen(value)) return err({ kind: 'SenNotSafeInteger', value });
  // `-0` を返さない。`Object.is(-0, 0)` は false なので比較で事故る
  return ok((value === 0 ? 0 : value) as Sen);
}

/** 円から銭へ。**表示層から受け取った値には使わない**（丸めが入るため） */
export function senFromYen(yen: number): Result<Sen, DomainError> {
  return createSen(Math.round(yen * 100));
}
