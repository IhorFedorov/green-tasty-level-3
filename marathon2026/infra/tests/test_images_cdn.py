"""Offline invariants; does not prove AWS runtime policies or fetch images."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
TF = ROOT / 'marathon2026/infra/terraform'

def resource(text, kind, name):
    start = text.index('resource "' + kind + '" "' + name + '"')
    begin = text.index('{', start)
    depth = 1
    end = begin + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[begin:end]

class ImagesCdnTests(unittest.TestCase):
    def test_bucket_public_access_is_fully_blocked(self):
        block = resource((TF / 's3.tf').read_text(), 'aws_s3_bucket_public_access_block', 'images')
        for key in ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets']:
            self.assertRegex(block, key + r'\s*=\s*true')

    def test_allow_uses_oac_source_arn_and_only_catalog_prefixes(self):
        block = resource((TF / 's3.tf').read_text(), 'aws_s3_bucket_policy', 'images')
        self.assertIn('Service = "cloudfront.amazonaws.com"', block)
        self.assertIn('"AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn', block)
        self.assertIn('Action    = "s3:GetObject"', block)
        self.assertIn('/assets/img/dishes/*', block)
        self.assertIn('/assets/img/locations/*', block)
        self.assertEqual(len(re.findall(r'Effect\s*=\s*"Allow"', block)), 1)
        self.assertIn('"aws:SecureTransport" = "false"', block)
        self.assertIn('Effect    = "Deny"', block)

    def test_existing_distribution_and_oac_are_reused(self):
        text = (TF / 'cloudfront.tf').read_text()
        self.assertEqual(text.count('resource "aws_cloudfront_distribution"'), 1)
        self.assertEqual(text.count('resource "aws_cloudfront_origin_access_control"'), 1)
        self.assertIn('for_each = ["assets/img/dishes/*", "assets/img/locations/*"]', text)
        self.assertIn('target_origin_id       = "s3-catalog-images"', text)
        self.assertIn('target_origin_id       = "s3-frontend"', text)
        self.assertIn('signing_behavior                  = "always"', text)

    def test_frontend_consumes_image_url_without_s3_host_rewrite(self):
        frontend = ROOT / 'marathon2026/frontend/restaurant-frontend-app/src/app'
        for relative, binding in [
            ('shared/custom-components/dish-card/dish-card.component.html', '[src]="dish().imageUrl"'),
            ('components/location-overview/location-overview.component.html', 'location?.imageUrl'),
            ('components/group-orders/participant-card/participant-card.component.html', '[src]="item.dish.imageUrl"'),
        ]:
            template = (frontend / relative).read_text()
            self.assertIn(binding, template)
            self.assertNotIn('s3.amazonaws.com', template)

    def test_lambda_cdn_config_is_required_template(self):
        import json
        config = json.loads((ROOT / 'marathon2026/backend/restaurant-backend-app/dnapp/lambdas/api-handler/lambda_config.json').read_text())
        self.assertEqual(config['env_variables']['IMAGES_CDN_BASE_URL'], '${imagesCdnBaseUrl}')

if __name__ == '__main__':
    unittest.main()
