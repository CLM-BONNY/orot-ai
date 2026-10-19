"""Replace images in one existing ECS service task, wait, verify and roll back on failure.
This script never creates infrastructure or downloads a model.
"""
import argparse
import json
import re
import subprocess
from urllib.request import urlopen

TASK_FIELDS = ('family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes',
               'placementConstraints','requiresCompatibilities','cpu','memory','pidMode','ipcMode',
               'proxyConfiguration','inferenceAccelerators','ephemeralStorage','runtimePlatform')


def render_task(task, images, revision):
    if not images or any(not re.fullmatch(r'[^\s@]+@sha256:[a-f0-9]{64}', image) for image in images.values()):
        raise ValueError('Deploy only immutable image digests')
    result = {k:task[k] for k in TASK_FIELDS if k in task}
    result = json.loads(json.dumps(result))
    names = [c['name'] for c in result['containerDefinitions']]
    if len(names)!=len(set(names)) or not set(images).issubset(names):
        raise ValueError('Container names do not match the existing task')
    for c in result['containerDefinitions']:
        if c['name'] in images:
            c['image']=images[c['name']]
            c['environment']=[e for e in c.get('environment',[]) if e['name']!='APP_REVISION']+[
                {'name':'APP_REVISION','value':revision}]
    return result


def aws(*args, body=None):
    result=subprocess.run(['aws',*args,'--output','json'],input=json.dumps(body) if body is not None else None,
                          text=True,capture_output=True,check=True,timeout=900)
    return json.loads(result.stdout) if result.stdout.strip() else None


def service(cluster,name):
    result=aws('ecs','describe-services','--cluster',cluster,'--services',name)
    if result.get('failures') or len(result['services'])!=1:raise RuntimeError('ECS service not found')
    return result['services'][0]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cluster',required=True);parser.add_argument('--service',required=True)
    parser.add_argument('--revision',required=True);parser.add_argument('--image',action='append',required=True)
    parser.add_argument('--url',help='HTTPS application URL; omitted for private inference-only deployments')
    args=parser.parse_args()
    images=dict(item.split('=',1) for item in args.image)
    previous=service(args.cluster,args.service)['taskDefinition']
    task=aws('ecs','describe-task-definition','--task-definition',previous)['taskDefinition']
    registered=aws('ecs','register-task-definition','--cli-input-json','file:///dev/stdin',
                   body=render_task(task,images,args.revision))['taskDefinition']['taskDefinitionArn']
    def update(arn):
        aws('ecs','update-service','--cluster',args.cluster,'--service',args.service,'--task-definition',arn)
        aws('ecs','wait','services-stable','--cluster',args.cluster,'--services',args.service)
        if service(args.cluster,args.service)['taskDefinition']!=arn:raise RuntimeError('Deployment rolled back or did not activate')
    try:
        update(registered)
        if args.url:
            if not args.url.startswith('https://'):raise ValueError('Use the HTTPS production URL')
            for path in ['/api/health','/release.json']:
                with urlopen(args.url.rstrip('/')+path,timeout=15) as response:
                    if json.load(response).get('code_revision')!=args.revision:raise RuntimeError('Deployed revision does not match')
    except Exception:
        update(previous)
        raise
    print(json.dumps({'service':args.service,'previous_task_definition':previous,'task_definition':registered,
                      'code_revision':args.revision,'images':images,'verified':True},indent=2))


if __name__=='__main__':main()
