import { RosCommand } from '../RosCommand';

describe('RosCommand.toWords()', () => {
  test('bare path → [path] with no .tag= and no trailing terminator', () => {
    expect(new RosCommand('/ip/address/print').toWords()).toEqual([
      '/ip/address/print',
    ]);
  });

  test('camelCase attributes → kebab-case', () => {
    expect(
      new RosCommand('/ip/hotspot/user/add', {
        attributes: { limitUptime: '1h', maxSharedUsers: 3 },
      }).toWords()
    ).toEqual([
      '/ip/hotspot/user/add',
      '=limit-uptime=1h',
      '=max-shared-users=3',
    ]);
  });

  test('boolean attributes → yes/no; undefined skipped', () => {
    expect(
      new RosCommand('/ip/firewall/filter/add', {
        attributes: { disabled: false, action: 'accept', comment: undefined },
      }).toWords()
    ).toEqual([
      '/ip/firewall/filter/add',
      '=disabled=no',
      '=action=accept',
    ]);
  });

  test("empty '' values skipped by default, preserved with preserveEmptyValues", () => {
    expect(
      new RosCommand('/ip/hotspot/user/add', { attributes: { comment: '' } })
        .toWords()
    ).toEqual(['/ip/hotspot/user/add']);

    expect(
      new RosCommand('/ip/hotspot/user/add', {
        attributes: { comment: '' },
        preserveEmptyValues: true,
      }).toWords()
    ).toEqual(['/ip/hotspot/user/add', '=comment=']);
  });

  test('query operators =, <, >, ? and -', () => {
    expect(
      new RosCommand('/ip/hotspot/user/print', {
        queries: [
          { field: 'name', operator: '=', value: 'wasl' },
          { field: 'bytes-in', operator: '>', value: '100' },
          { field: 'bytes-out', operator: '<', value: '200' },
          { field: 'comment', operator: '?' },
          { field: 'disabled', operator: '-' },
        ],
      }).toWords()
    ).toEqual([
      '/ip/hotspot/user/print',
      '?name=wasl',
      '?bytes-in>100',
      '?bytes-out<200',
      '?comment',
      '?-disabled',
    ]);
  });

  test('.proplist emits =.proplist=field1,field2', () => {
    expect(
      new RosCommand('/ip/address/print', { proplist: ['.id', 'address'] }).toWords()
    ).toEqual(['/ip/address/print', '=.proplist=.id,address']);
  });

  test('wire-byte guarantee: attributes + preserveEmptyValues + query', () => {
    expect(
      new RosCommand('/ip/hotspot/user/add', {
        attributes: { limitUptime: '1h', disabled: true },
        preserveEmptyValues: true,
        queries: [{ field: 'name', operator: '=', value: 'x' }],
      }).toWords()
    ).toEqual([
      '/ip/hotspot/user/add',
      '=limit-uptime=1h',
      '=disabled=yes',
      '?name=x',
    ]);
  });

  test('label is exposed for app correlation but never lands on the wire', () => {
    const cmd = new RosCommand('/user/print', { label: 'fetch-users' });
    expect(cmd.label).toBe('fetch-users');
    expect(cmd.toWords()).toEqual(['/user/print']);
  });

  test('attribute value containing = is preserved', () => {
    expect(
      new RosCommand('/x', { attributes: { address: '10.0.0.1/24' } }).toWords()
    ).toEqual(['/x', '=address=10.0.0.1/24']);
  });
});