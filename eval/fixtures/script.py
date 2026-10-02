"""读取 CSV 文件并输出数据行数（不含表头行）。

用法:
    python script.py <csv文件路径>

计数口径：按 CSV **记录**计数，不是按物理行计数。
"""

import csv
import sys


def count_rows(path):
    """返回 CSV 的数据记录数（不含表头行）。"""
    with open(path, encoding='utf-8-sig', newline='') as fp:
        # 关键点：必须交给 csv 模块解析，并且用 newline='' 打开文件。
        # 逐行统计（例如 read().splitlines() / 逐行 for line in fp）会把
        # 带引号字段内部的换行也当成新的一行：sample.csv 里 alice 的 note
        # 字段本身就是两行（"first line\nsecond line"），于是数据行被多算
        # 成 3，而真实记录只有 2 条（alice、bob）。
        # 空行不是记录（csv.reader 返回空列表），跳过；全空字段的行
        # （如 ",,"）仍是记录，照常计入。
        records = [row for row in csv.reader(fp) if row]
    # 第一条记录是表头，不计入数据行
    return max(0, len(records) - 1)


def main(argv):
    if len(argv) != 2:
        print('用法: python script.py <csv文件路径>', file=sys.stderr)
        return 2
    print(count_rows(argv[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
