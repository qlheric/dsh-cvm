# 覆盖账样例

本目录放**校验器可直接校验**的样例账本，供 CI 与手工验证使用。

- `minimal-valid.json` —— 4 个单元、覆盖 4 种状态（`covered` / `planned` / `deferred` / `candidate`），**必须 exit 0**。

## 校验方式

```bash
node src/domain/ledger-validator.mjs ledger-samples/minimal-valid.json
# → ✓ 账本合法：...（4 个覆盖单元）  exit 0
```

## 为什么要样例

1. **让 CI 真的校到东西**——只跑自测只能证明"校验器自身逻辑对"，样例账本能证明"一份像样的账本能通过"；
2. **给使用者一个可抄的模板**——字段、编码、排序都能照着写；
3. **格式漂移的哨兵**——将来改字段规范时，样例账本会第一个红。

## 注意

样例账本是**手写的**（在这个目录里属于"输入数据"，不是"由确定性代码生成的产品账本"）。
**真实账本必须由代码生成**（`generated_by: "deterministic"`），详见 `设计-覆盖账-确定性覆盖单元.md` 第七节。
