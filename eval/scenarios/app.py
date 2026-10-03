"""读取 CSV 并输出记录数。

用法:
    python app.py <csv文件路径>
"""

import sys

from lib import parse_records


def main(argv):
    if len(argv) != 2:
        print('用法: python app.py <csv文件路径>', file=sys.stderr)
        return 2
    # 必须用 newline='' 打开：否则文本层会先把 \r\n / \r 统一翻译成 \n，
    # 交给 csv 解析器的就不再是原始字节，引号字段内的换行会被悄悄改写。
    # 计数口径由 lib.parse_records 负责（按 CSV 记录，而不是按物理行）。
    with open(argv[1], encoding='utf-8', newline='') as fp:
        raw = fp.read()
    records = parse_records(raw)
    print(len(records))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))