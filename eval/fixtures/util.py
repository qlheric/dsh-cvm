def parse(s):
    """解析逗号分隔字符串为列表。空输入（None / 空串 / 纯空白）返回空列表。"""
    if s is None or not s.strip():
        return []
    return s.split(',')


if __name__ == '__main__':
    assert parse('') == []
    assert parse('   ') == []
    assert parse(None) == []
    assert parse('a,b') == ['a', 'b']
    assert parse('a, b') == ['a', ' b']
    print('parse() 空输入自检通过')
