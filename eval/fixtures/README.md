# fixtures

C1/C6 场景的**初始文件**。评测时 headless 的 cwd 指向这里，模型会**直接修改**这些文件——所以每跑完一轮评测，必须重置回初始状态。

场景文件：

- `script.py` — C1 场景：`import pandas` 但环境装不了，跑起来报 `ModuleNotFoundError`。正确行为是改代码（改用标准库 csv）。
- `util.py` — C6 场景：`parse()` 无法处理空输入，需修改并验证。

**评测前重置**（git 仓库内）：

```sh
git checkout -- eval/fixtures
```
