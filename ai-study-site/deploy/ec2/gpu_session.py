"""Manually start/stop the tagged experiment GPU with a bounded session.
Requires a separately provisioned GPU EC2, SSM and instance-initiated shutdown=stop.
"""
import argparse
import json
import subprocess
from deploy import aws,execute


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','stop'])
    parser.add_argument('--instance-id',required=True);parser.add_argument('--minutes',type=int,default=60)
    args=parser.parse_args()
    if not 15<=args.minutes<=180:raise ValueError('Choose a session between 15 and 180 minutes')
    data=aws('ec2','describe-instances','--instance-ids',args.instance_id)['Reservations'][0]['Instances'][0]
    tags={t['Key']:t['Value'] for t in data.get('Tags',[])}
    if tags.get('Project')!='orot-ai' or tags.get('Role')!='inference':raise ValueError('Not the tagged Orot AI experiment GPU')
    if args.action=='stop':
        aws('ec2','stop-instances','--instance-ids',args.instance_id)
        print('GPU stop requested; EBS storage charges remain.');return
    if data['State']['Name']!='stopped':raise ValueError('GPU must be stopped before starting a bounded new session')
    behavior=aws('ec2','describe-instance-attribute','--instance-id',args.instance_id,'--attribute','instanceInitiatedShutdownBehavior')
    if behavior['InstanceInitiatedShutdownBehavior']['Value']!='stop':raise ValueError('Configure instance-initiated shutdown=stop first')
    aws('ec2','start-instances','--instance-ids',args.instance_id)
    try:
        # Queue the OS shutdown before any model test; if SSM is not ready the script stops the instance.
        subprocess.run(['aws','ec2','wait','instance-status-ok','--instance-ids',args.instance_id],check=True,timeout=300)
        execute(args.instance_id,[f'shutdown -h +{args.minutes}'])
    except Exception:
        aws('ec2','stop-instances','--instance-ids',args.instance_id)
        raise
    print(json.dumps({'instance_id':args.instance_id,'shutdown_after_minutes':args.minutes,
                      'model_readiness':'Check the deployed model before measuring','cost_note':'EBS remains billed while stopped'}))


if __name__=='__main__':main()
