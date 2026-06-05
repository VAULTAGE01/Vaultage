export const CSV_IMPORT_HEADERS = ['name', 'type', 'value', 'username', 'url', 'notes', 'scope', 'tags']

export function templateCsv(): string {
  const header = CSV_IMPORT_HEADERS.join(',')
  const examples = [
    [
      'GitHub Personal Token',
      'apiKey',
      'demo-github-token-placeholder',
      '',
      'https://github.com',
      'Used for CI/CD pipelines',
      'production',
      'dev;github',
    ],
    [
      'AWS Access Key',
      'apiKey',
      'AKIA...',
      'my-iam-user',
      '',
      'Read-only S3 access',
      'production',
      'aws;cloud',
    ],
    [
      'Personal Email',
      'password',
      'a-very-strong-password',
      'me@example.com',
      'https://gmail.com',
      '',
      '',
      'personal',
    ],
    [
      'SSH Key - Server A',
      'sshKey',
      '<paste-open-ssh-private-key-here>',
      '',
      '',
      'Production bastion host',
      'production',
      'infra;ssh',
    ],
  ]
  return [header, ...examples.map(rowToCsv)].join('\n') + '\n'
}

function rowToCsv(cells: string[]): string {
  return cells.map(c => {
    if (c == null) return ''
    if (/[,"\r\n]/.test(c)) return '"' + c.replace(/"/g, '""') + '"'
    return c
  }).join(',')
}
