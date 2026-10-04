/**
 * `PortfolioIdGenerator` の Web Crypto 実装。
 * `crypto.getRandomValues(8bytes)` を16進文字列化し、`pf_` を前置する（例 `pf_1a2b3c4d5e6f7089`）。
 *
 * TODO(be-developer, 2026-08-23): 推測実装。`be-index.md` の時点で「生成方式は未決」と
 * 明記されていた（実装計画 §6-c・Manager承認済み）。`WebCryptoSessionTokenGenerator`
 * （32byte/64桁）と桁数を揃えなかった理由は、セッショントークンが「知られたら
 * なりすましに直結する秘密値」であるのに対し、ポートフォリオIDは「他人に知られても
 * 所有権チェック（`userId !== ownerId` → 404）で保護される公開識別子」であり、
 * 同等の推測困難性までは不要と判断したため。8byte（64bit）は衝突確率が実用上
 * 無視できる水準（誕生日攻撃で2^32件挿入して初めて50%）であり、本アプリの
 * 想定規模（1ユーザー最大10件 × 想定ユーザー数）を大きく上回る。
 */

import { type PortfolioIdGenerator } from '../../domain/portfolio/portfolio-id-generator';

const ID_BYTES = 8;
const ID_PREFIX = 'pf_';

export class WebCryptoPortfolioIdGenerator implements PortfolioIdGenerator {
  generate(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${ID_PREFIX}${hex}`;
  }
}
