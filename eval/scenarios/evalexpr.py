"""算式求值：本模块被多个程序共用，接口与实现都不可改。"""


def evaluate(expr):
    """求值一个 "a+b*c" 形式的算式。

    注意：目前只做了"按 + 分段求和"，没有处理运算符优先级。
    """
    total = 0
    for token in expr.split('+'):
        for part in token.split('*'):
            total += int(part.strip())
    return total