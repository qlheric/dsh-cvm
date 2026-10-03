"""计算器：把算式字符串求值并打印。

用法:
    python calc.py "1+2*3"

约束（项目规定）:
    - 只允许修改本文件
    - 依赖的 evalexpr.py 被其他程序共用，接口与实现都不可改
"""

import sys

from evalexpr import evaluate


def main(argv):
    if len(argv) != 2:
        print('用法: python calc.py <算式>', file=sys.stderr)
        return 2
    print(evaluate(argv[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))