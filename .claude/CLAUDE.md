# ��ЃX�R�A�����O Web�A�v�� (TypeScript x Cloudflare)

## �v���W�F�N�g�T�v

�}�X�^�[���[�U�[���o�^������Ѓf�[�^�i1000�Јȏ�j�𐮌`�iCAGR�E���ρE�l�����Z�j���A
���[�U�[���Ƃɐݒ�\��臒l��10�i�K�ɃX�R�A�����O���A���[�_�[�`���[�g�ŕ\������Web�A�v���B
���̓f�[�^�E���`�f�[�^�͗����i��������B

## �Z�p�X�^�b�N

- �����^�C��: Cloudflare Workers (�V���O��Worker�\��)
- API: Hono / �o���f�[�V����: zod (handler���E�̂�)
- DB: Cloudflare D1 + Drizzle ORM / �}�C�O���[�V����: drizzle-kit + wrangler d1 migrations
- �t�����g: React + TypeScript + Vite + Recharts (Workers Assets �Ŕz�M)
- �F��: better-auth (�}�X�^�[���[�U�[ / ��ʃ��[�U�[)
- �e�X�g: Vitest (domain�w�͏�TS) + @cloudflare/vitest-pool-workers (����)
- �p�b�P�[�W�Ǘ�: pnpm

## �A�[�L�e�N�`�� (�y��DDD / ���C���[�h)

src/
domain/ # ��TS�B�t���[�����[�N�ECloudflare API�Ezod �� import ���Ȃ�
company/ # Company�W��, FinancialRecord, TransformedMetric, CAGR
scoring/ # UserScoringPolicy�W��, Score, ScoreThreshold, ScoringService
shared/ # Result�^, �h���C���G���[���
usecase/ # �A�v���P�[�V�����T�[�r�X (1���[�X�P�[�X=1�֐�/�N���X)
infra/
d1/ # Drizzle schema + ���|�W�g������ (domain��IF������)
handler/ # Hono ���[�g�EDTO�Ezod�X�L�[�}
index.ts # Worker �G���g�� (DI�g�ݗ���)
frontend/ # React + Vite + Recharts
db/migrations/
docs/
glossary.md # ���r�L�^�X���� (�K����Ɋm�F)
domain-model.md
adr/

## �ˑ����[�� (��Ό���)

- `src/domain` �͊O���p�b�P�[�W�� import ���Ȃ� (��TS)�Bhono / drizzle / zod / cloudflare:* �� import ������ᔽ�B
- �ˑ�����: handler -> usecase -> domain <- infra (infra �� domain �̃��|�W�g��IF������)�B
- domain ��: scoring �� company �� TransformedMetric ���Q�Ƃ��Ă悢�B�t�͋֎~�B
- �W����܂����Q�Ƃ� ID (CompanyId, UserId) �ōs���A�I�u�W�F�N�g�𒼐ڎ����Ȃ��B
- D1/Workers �ŗL�̌^ (D1Database ��) �� infra �� index.ts �݂̂Ɍ����B

## DDD�����K�� (TypeScript)

- �l�I�u�W�F�N�g�� branded type + �t�@�N�g���֐��ŕs�Ϗ��������:

```ts
type Score = number & { readonly __brand: 'Score' }; // 1..10 ����
function createScore(v: number): Result<Score, DomainError> { ... }
```

- `as Score` �̃L���X�g���t�@�N�g���O�ŏ�������ᔽ�B
- �G���e�B�e�B�E�W��̓N���X�Ŏ������A�t�B�[���h�� private�B��ԕύX�̓��\�b�h�o�R�ŕs�Ϗ��������B
- ���|�W�g��IF�� domain ���ɏ���: `interface CompanyRepository { ... }`
- �h���C�����W�b�N�� usecase / handler / frontend �ɏ����Ȃ��i�n���ǋ֎~�j�B�v�Z�E����͕K�� domain �ցB
- �G���[�� throw ���� `Result<T, E>` �ŕԂ��B�h���C���G���[�͔��ʉ\�� `kind` ������
  (��: `{ kind: 'ThresholdNotAscending' }`)�Bhandler �� HTTP�X�e�[�^�X�ɕϊ�����B
- zod �� handler �̓��o�͌��؂̂݁Bdomain �̕s�Ϗ����� domain ���g�����i��d��`���Ȃ��j�B

## ����

- `docs/glossary.md` �̗p������̂܂܌^���E�֐����Ɏg���B�V�����T�O���o�����ɗp��W�֒ǉ��B
- frontend �Ƌ��L����^�� domain ���� export ���ADTO�� handler �Œ�`����B

## �h���C���ŗL���[��

- Score �� 1?10 �̐����B���E�l�́u臒l�ȏ�Ŏ��̒i�K�v�i>= ����j�B
- ScoreThreshold �͏���9�̋��E�l�����i10�i�K�����j�B�����łȂ���ΐ����G���[�B
- UserScoringPolicy �̓��[�U�[���ƁE�w�W���Ƃ�臒l���㏑���ł���B���ݒ�̓f�t�H���g臒l�Ƀt�H�[���o�b�N�B
- CAGR = (�I�l/�n�l)^(1/�N��) - 1�B�n�l��0�ȉ��E�N��0�͌v�Z�s�\�G���[ (NaN/Infinity�𗬂��Ȃ�)�B
- FinancialRecord (����) �� TransformedMetric (���`����) �͗���D1�ɕۑ�����B
���`�f�[�^�͍Čv�Z�\�����A�č��ړI�Ōv�Z���_�̒l�ƌv�Z�o�[�W������ۑ�����B
- �ꗗ�E���[�_�[�`���[�g�p�̓ǂݎ��� usecase �Ő�p�N�G�� (read model) ���g���Ă悢 (1000�В��̂���)�B

## �R�}���h

- �J��: `pnpm dev` (wrangler dev + vite)
- �e�X�g: `pnpm test` / �h���C���̂�: `pnpm vitest run src/domain`
- �^�`�F�b�N�ELint: `pnpm typecheck`/`pnpm lint` (eslint: domain �̊O��import�֎~���[���L��)
- �}�C�O���[�V��������: `pnpm drizzle-kit generate` -> �K�p: `pnpm wrangler d1 migrations apply DB`
- �f�v���C: `pnpm wrangler deploy`

## ��Ǝ菇

1. �V�@�\�͂܂� domain-modeler agent �Ń��f������ -> docs/domain-model.md �X�V
2. usecase-add skill �̎菇�� �e�X�g -> domain -> usecase -> infra -> handler -> frontend �̏��Ɏ���
3. ������ ddd-reviewer agent �Ń��r���[�Aglossary-keeper agent �Ŗ����č�
