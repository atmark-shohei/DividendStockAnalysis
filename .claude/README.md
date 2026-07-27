��ЃX�R�A�����OWeb�A�v�� (TypeScript �~ Cloudflare) �� Claude Code �p DDD �X�^�[�^�[�B

## ������

- `CLAUDE.md` - �v���W�F�N�g�K��i���C���[�E�ˑ����[���E�h���C���ŗL���[���j
- `.claude/agents/` - domain-modeler / ddd-reviewer / test-writer / glossary-keeper
- `.claude/skills/` - ddd-scaffold / event-storming / usecase-add / adr
- `docs/glossary.md` - ���r�L�^�X����i�����Łj

�� zip�W�J���Ƀt�H���_���� `dot-claude` �̏ꍇ�� `.claude` �Ƀ��l�[�����Ă��������B

## �Z�b�g�A�b�v�菇

```bash
# 1. �v���W�F�N�g�쐬
pnpm create hono@latest app -- --template cloudflare-workers
cd app && ���̃X�^�[�^�[�̒��g���R�s�[

# 2. �ˑ��ǉ�
pnpm add drizzle-orm zod @hono/zod-validator
pnpm add -D drizzle-kit vitest @cloudflare/vitest-pool-workers wrangler

# 3. D1 �쐬
pnpm wrangler d1 create scoring-db  # �o�͂� wrangler.toml �ɒǋL

# 4. Claude Code �N��
claude
```

## �ŏ��ɂ�邱�Ɓi�������j

1. `claude` �N�� -> event-storming skill �Ŏ����̎w�W�E���`���[������̉�
2. domain-modeler agent �� docs/domain-model.md ���쐬
3. usecase-add skill �̎菇�ōŏ��̃��[�X�P�[�X�u��Ѓf�[�^��o�^����v������
4. �ȍ~�A1���[�X�P�[�X���J��Ԃ��B�R�~�b�g�O�� ddd-reviewer agent
