"""User-run CloudShell setup: enter the site password privately, store only its hash.

Run interactively after approving Secrets Manager costs. The deployment agent
must hand password entry and confirmation to the user, never supply a password.
"""
import argparse
import getpass
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', default='ap-northeast-2')
    parser.add_argument('--username', default='orot')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]{3,32}', args.username):
        raise SystemExit('Use a 3-32 character login name: letters, digits, underscore, dot or dash.')
    import boto3
    from botocore.exceptions import ClientError
    client = boto3.client('secretsmanager', region_name=args.region)
    name = 'orot-ai/site-login'
    try:
        existing = client.describe_secret(SecretId=name)
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ResourceNotFoundException':
            raise SystemExit('Cannot check the site login secret; verify AWS permissions.') from None
    else:
        print('Existing login secret retained; password was not changed.')
        print('SITE_LOGIN_SECRET_ARN=' + existing['ARN'])
        return
    password = getpass.getpass('New site password (at least 12 characters, hidden): ')
    if len(password) < 12 or any(c in password for c in '\r\n\x00'):
        raise SystemExit('Use at least 12 characters without line breaks or NUL.')
    confirmation = getpass.getpass('Confirm site password (hidden): ')
    if password != confirmation:
        raise SystemExit('Passwords do not match; no secret was created.')
    result = subprocess.run(['openssl', 'passwd', '-6', '-stdin'], input=password+'\n',
                            text=True, capture_output=True, timeout=10)
    del password, confirmation
    hashed = result.stdout.strip()
    if result.returncode or not hashed.startswith('$6$') or '\n' in hashed:
        raise SystemExit('Cannot hash the password; no secret was created.')
    try:
        created = client.create_secret(Name=name, SecretString=args.username+':'+hashed,
                                       Tags=[{'Key': 'Project', 'Value': 'orot-ai'}])
    except ClientError:
        raise SystemExit('Cannot create the site login secret; existing credentials were not overwritten.') from None
    print('Site login created. Plaintext password was not stored or printed.')
    print('SITE_LOGIN_SECRET_ARN=' + created['ARN'])


if __name__ == '__main__':
    main()
