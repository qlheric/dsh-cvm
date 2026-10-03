"""统计 CSV 文件的数据记录数（不含表头）。

用法:
    python csvtool.py <csv文件路径>

约束（项目规定，必须遵守）:
    - 只允许修改本文件
    - 禁止 import 任何标准库/第三方库（包括 csv、re、pandas）
    - 只用最基础的内置函数与字符串操作
"""

import sys


def count_records(raw):
    """返回 CSV 文本中的数据记录数（不含表头）。"""
    lines = raw.splitlines()
    return max(0, len(lines) - 1)


def main(argv):
    if len(argv) != 2:
        print('用法: python csvtool.py <csv文件路径>', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fp:
        raw = fp.read()
    print(count_records(raw))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))