"""Offline policy-subset checks, not an AWS effective-permission simulation."""
import fnmatch
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / 'marathon2026/backend/restaurant-backend-app'
ACCOUNT = '955094289797'
REGION = 'eu-north-1'
POOL = f'arn:aws:cognito-idp:{REGION}:{ACCOUNT}:userpool/eu-north-1_N6Ct4Bj3m'
QUEUE = f'arn:aws:sqs:{REGION}:{ACCOUNT}:restaurant-reports-queue'


def table(name):
    return f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{name}'


def granted(policy, action, arn):
    """Evaluate only the Action/Resource/Effect subset used by these policies."""
    matches = []
    for statement in policy['Statement']:
        actions = statement['Action']
        resources = statement['Resource']
        if isinstance(actions, str):
            actions = [actions]
        if isinstance(resources, str):
            resources = [resources]
        if any(fnmatch.fnmatchcase(action.lower(), a.lower()) for a in actions) and any(
                fnmatch.fnmatchcase(arn, resource) for resource in resources):
            matches.append(statement['Effect'])
    return 'Allow' in matches and 'Deny' not in matches


class RuntimeIamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import syndicate.core as core
        from syndicate.core.conf.processor import ConfigHolder
        from syndicate.core.build.meta_processor import create_resource_json, _resolve_aliases
        core.CONFIG = ConfigHolder(str(ROOT / '.tools/deployment/eu-north-1/syndicate'))
        cls.meta = _resolve_aliases(create_resource_json(str(BACKEND), 'iam-test'))
        cls.policies = {}
        for name in ('api-handler', 'reports-handler', 'report-sender'):
            role = cls.meta[name + '-role']
            assert not role['predefined_policies']
            assert len(role['custom_policies']) == 1
            cls.policies[name] = cls.meta[role['custom_policies'][0]]['policy_content']

    def test_policy_subset_has_no_hidden_grants(self):
        for policy in self.policies.values():
            self.assertLessEqual(len(json.dumps(policy, separators=(',', ':'))), 6144)
            self.assertEqual(set(policy), {'Version', 'Statement'})
            for statement in policy['Statement']:
                self.assertEqual(set(statement), {'Sid', 'Effect', 'Action', 'Resource'})
                self.assertNotIn('*', statement['Resource'])
                self.assertNotIn('${', json.dumps(statement))
                if statement['Effect'] == 'Allow':
                    self.assertTrue(all('*' not in a for a in statement['Action']))

    def test_api_required_table_operations(self):
        expected = {
            'Waiters': ['GetItem', 'Scan', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem'],
            'Feedback': ['Query', 'PutItem', 'UpdateItem'],
            'Tables': ['GetItem', 'Scan', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem'],
            'Dishes': ['GetItem', 'BatchGetItem', 'Scan', 'PutItem', 'UpdateItem', 'DeleteItem'],
            'Reservations': ['GetItem', 'Query', 'PutItem', 'UpdateItem'],
            'Locations': ['GetItem', 'Scan', 'PutItem', 'UpdateItem', 'DeleteItem'],
            'ProfileImages': ['GetItem', 'PutItem', 'UpdateItem'],
            'Orders': ['GetItem', 'Scan', 'Query', 'PutItem', 'UpdateItem'],
            'Reports': ['Scan'], 'ReportsHistory': ['Query', 'PutItem', 'UpdateItem'],
            'Notifications': ['GetItem', 'Query', 'PutItem', 'UpdateItem'],
            'GroupReservations': ['GetItem', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem'],
            'GuestSessions': ['GetItem', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem'],
        }
        for name, actions in expected.items():
            for action in actions + ['DescribeTable']:
                with self.subTest(table=name, action=action):
                    self.assertTrue(granted(self.policies['api-handler'], 'dynamodb:' + action, table(name)))

    def test_orders_scan_only_api_and_exact_table(self):
        self.assertTrue(granted(self.policies['api-handler'], 'dynamodb:Scan', table('Orders')))
        for arn in (table('Orders') + '/index/GSI_ReservationId', table('Orders-other'),
                    table('Orders').replace(ACCOUNT, '111111111111'),
                    table('Orders').replace(REGION, 'us-east-1')):
            self.assertFalse(granted(self.policies['api-handler'], 'dynamodb:Scan', arn))
        for name in ('reports-handler', 'report-sender'):
            self.assertFalse(granted(self.policies[name], 'dynamodb:Scan', table('Orders')))

    def test_only_approved_scan_delta_from_reviewed_policies(self):
        import copy
        import hashlib
        raw = json.loads((ROOT / 'marathon2026/backend/restaurant-backend-app/deployment_resources.json').read_text())
        baselines = {
            'lambda-basic-execution': '9fd0d29c3a82f2ba94698b05989f67100e6228a4b8b2323b313e59004a495ac6',
            'reports-handler-runtime': 'c29f7a1b2de63e91d5599320af5cfac613210707577a2c61a1b216c0066c2f81',
            'report-sender-runtime': 'dcd7ec1a0c25f848849a9f61d2430c83a2ddd7a66c72571936d6133d660646b3',
        }
        for name, baseline in baselines.items():
            policy = copy.deepcopy(raw[name]['policy_content'])
            if name == 'lambda-basic-execution':
                orders = next(s for s in policy['Statement'] if s['Sid'] == 'TableOrders')
                self.assertEqual(orders['Resource'], ['arn:aws:dynamodb:${region}:${account_id}:table/Orders'])
                self.assertEqual(orders['Action'].count('dynamodb:Scan'), 1)
                orders['Action'].remove('dynamodb:Scan')
            # Removing the sole approved addition restores every original restriction,
            # including DenyDeploymentStorage and both other Lambda policies.
            canonical = json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()
            self.assertEqual(hashlib.sha256(canonical).hexdigest(), baseline)

    def test_exact_indexes_and_transaction_underlying_updates(self):
        p = self.policies['api-handler']
        for name, meta in self.meta.items():
            if meta['resource_type'] == 'dynamodb_table':
                for index in meta.get('global_indexes', []):
                    self.assertTrue(granted(p, 'dynamodb:Query', table(name) + '/index/' + index['name']))
        self.assertFalse(granted(p, 'dynamodb:Query', table('Orders') + '/index/Unrelated'))
        for name in ('Orders', 'GroupReservations'):
            self.assertTrue(granted(p, 'dynamodb:UpdateItem', table(name)))
        self.assertFalse(granted(p, 'dynamodb:DeleteItem', table('Orders')))

    def test_catalog_upload_and_profile_lifecycle(self):
        p = self.policies['api-handler']
        for prefix in ('dishes', 'locations'):
            arn = f'arn:aws:s3:::restaurant-backend-dev-images-{ACCOUNT}/assets/img/{prefix}/x.jpg'
            self.assertTrue(granted(p, 's3:PutObject', arn))
            self.assertFalse(granted(p, 's3:DeleteObject', arn))
            self.assertFalse(granted(p, 's3:PutObjectAcl', arn))
        profile = f'arn:aws:s3:::restaurant-backend-dev-profile-images-{ACCOUNT}/profile-img/user.png'
        for action in ('GetObject', 'PutObject', 'DeleteObject'):
            self.assertTrue(granted(p, 's3:' + action, profile))

    def test_state_lock_artifacts_and_unrelated_s3_denied(self):
        arns = [f'arn:aws:s3:::restaurant-terraform-state-{ACCOUNT}' + suffix
                for suffix in ('', '/restaurant/terraform.tfstate', '/restaurant/terraform.tfstate.tflock')]
        arns += [f'arn:aws:s3:::marathon2026-restaurant-artifacts-{ACCOUNT}/credentials.json',
                 'arn:aws:s3:::unrelated/private.txt',
                 f'arn:aws:s3:::restaurant-backend-dev-images-{ACCOUNT}/private/key',
                 f'arn:aws:s3:::restaurant-backend-dev-swagger-ui-{ACCOUNT}/index.html']
        for name, policy in self.policies.items():
            for arn in arns:
                for action in ('GetObject', 'PutObject', 'DeleteObject', 'ListBucket'):
                    with self.subTest(lambda_name=name, arn=arn, action=action):
                        self.assertFalse(granted(policy, 's3:' + action, arn))
            # Explicit deployment-storage denial wins even over a future broad Allow.
            expanded = {'Statement': policy['Statement'] + [
                {'Effect': 'Allow', 'Action': ['s3:*'], 'Resource': ['*']}]}
            self.assertFalse(granted(expanded, 's3:PutObject', arns[1]))

    def test_per_lambda_queue_database_and_cognito_separation(self):
        api, worker, sender = [self.policies[n] for n in ('api-handler', 'reports-handler', 'report-sender')]
        self.assertTrue(granted(api, 'sqs:SendMessage', QUEUE))
        self.assertFalse(granted(api, 'sqs:ReceiveMessage', QUEUE))
        for action in ('ReceiveMessage', 'DeleteMessage', 'GetQueueAttributes'):
            self.assertTrue(granted(worker, 'sqs:' + action, QUEUE))
        self.assertFalse(granted(worker, 'sqs:SendMessage', QUEUE))
        self.assertTrue(granted(worker, 'dynamodb:UpdateItem', table('Reports')))
        self.assertFalse(granted(worker, 'dynamodb:GetItem', table('Orders')))
        self.assertTrue(granted(sender, 'dynamodb:Scan', table('Reports')))
        self.assertTrue(granted(sender, 'dynamodb:GetItem', table('Locations')))
        self.assertFalse(granted(sender, 'dynamodb:PutItem', table('Reports')))
        self.assertTrue(granted(sender, 'cognito-idp:ListUsersInGroup', POOL))
        self.assertFalse(granted(sender, 'cognito-idp:AdminAddUserToGroup', POOL))

    def test_pool_scope_and_excess_permissions(self):
        p = self.policies['api-handler']
        for action in ('AdminGetUser', 'ListUsers', 'ListGroups', 'CreateGroup',
                       'AdminConfirmSignUp', 'AdminAddUserToGroup', 'AdminRemoveUserFromGroup',
                       'AdminUpdateUserAttributes', 'AdminListGroupsForUser'):
            self.assertTrue(granted(p, 'cognito-idp:' + action, POOL))
            self.assertFalse(granted(p, 'cognito-idp:' + action, POOL + '-other'))
        for policy in self.policies.values():
            for action in ('ssm:GetParameter', 'kms:Decrypt', 'cognito-idp:AdminInitiateAuth',
                           'cognito-idp:DeleteUserPool', 'cognito-idp:GetGroup',
                           'iam:PassRole', 'sts:AssumeRole', 'ses:SendRawEmail'):
                for arn in (POOL, '*', table('Orders')):
                    self.assertFalse(granted(policy, action, arn))

    def test_only_own_log_group_and_streams(self):
        for name, policy in self.policies.items():
            group = f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{name}'
            self.assertTrue(granted(policy, 'logs:CreateLogGroup', group))
            self.assertFalse(granted(policy, 'logs:PutLogEvents', group + ':log-stream/unused'))
            self.assertTrue(granted(policy, 'logs:PutLogEvents', group + ':log-stream:2026/test'))
            self.assertFalse(granted(policy, 'logs:PutLogEvents', group + '-unrelated:log-stream:test'))
