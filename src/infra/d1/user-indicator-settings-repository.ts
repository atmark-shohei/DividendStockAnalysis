/**
 * `UserIndicatorSettingsRepository` の D1 実装。ここだけが Drizzle と `D1Database` を知る
 * （`.claude/CLAUDE.md`）。
 */

import { eq } from 'drizzle-orm';
import { type BatchItem } from 'drizzle-orm/batch';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

import { METRIC_KEYS, type MetricKey } from '../../domain/shared/metric-key';
import {
  type BasisValueKey,
  type UserIndicatorSettings,
} from '../../domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '../../domain/scoring/user-indicator-settings-repository';
import { userIndicatorSettings } from './schema';

/** DB の文字列が既知の `MetricKey` かどうか（未知の値は書き込みバグなので捨てる） */
function isMetricKey(raw: string): raw is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(raw);
}

export class D1UserIndicatorSettingsRepository implements UserIndicatorSettingsRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async findByUserId(userId: number): Promise<UserIndicatorSettings | null> {
    const rows = await this.db
      .select()
      .from(userIndicatorSettings)
      .where(eq(userIndicatorSettings.userId, userId));

    if (rows.length === 0) return null;

    const selectedKeys: MetricKey[] = [];
    const basisValues: Partial<Record<BasisValueKey, number>> = {};
    for (const row of rows) {
      if (!isMetricKey(row.metricKey)) continue; // 防御的分岐（書き込みバグの兆候。捨てる）
      selectedKeys.push(row.metricKey);
      // ⑨MIX係数は常に basisValue が NULL（設定不可）。null は「値なし」なので持たせない
      if (row.metricKey !== 'mixCoefficient' && row.basisValue !== null) {
        basisValues[row.metricKey as BasisValueKey] = row.basisValue;
      }
    }

    return { selectedKeys, basisValues };
  }

  async replaceAll(userId: number, settings: UserIndicatorSettings): Promise<void> {
    // 「全削除→入れ直し」。D1 の batch は1トランザクションなので、
    // 途中で失敗しても中途半端な状態にならない（`company-repository.ts` と同じ方針）
    const statements: BatchItem<'sqlite'>[] = [
      this.db.delete(userIndicatorSettings).where(eq(userIndicatorSettings.userId, userId)),
    ];

    for (const key of settings.selectedKeys) {
      statements.push(
        this.db.insert(userIndicatorSettings).values({
          userId,
          metricKey: key,
          basisValue:
            key === 'mixCoefficient' ? null : (settings.basisValues[key as BasisValueKey] ?? null),
        }),
      );
    }

    const [first, ...rest] = statements;
    if (first === undefined) return;
    await this.db.batch([first, ...rest]);
  }
}
