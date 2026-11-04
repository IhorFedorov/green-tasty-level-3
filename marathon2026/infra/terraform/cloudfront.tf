resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "restaurant-frontend-oac"
  description                       = "OAC for restaurant-frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_navigation" {
  name    = "restaurant-spa-navigation"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite confirmed Angular routes only; never static assets"
  publish = true
  code    = file("${path.module}/spa-navigation.js")
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # cheapest tier — US/Canada/Europe edge locations only

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_navigation.arn
    }
    # Other frontend assets and Angular routes continue to use the frontend origin.
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # Exact bundled keys win before catalog wildcards; URI rewrites do not select origins.
  dynamic "ordered_cache_behavior" {
    for_each = [
      "assets/img/dishes/avocado-pine-nut-bowl.jpg",
      "assets/img/dishes/fresh-strawberry-mint-salad.jpg",
      "assets/img/dishes/roasted-sweet-potato-and-lentil-salad.jpg",
      "assets/img/dishes/spring-salad.jpg",
      "assets/img/locations/abashidze-street-9.jpg",
      "assets/img/locations/baratashvili-street-14.jpg",
      "assets/img/locations/rustaveli-avenue-48.jpg",
    ]
    content {
      path_pattern           = ordered_cache_behavior.value
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = "s3-frontend"
      viewer_protocol_policy = "redirect-to-https"
      compress               = true
      forwarded_values {
        query_string = false
        cookies { forward = "none" }
      }
    }
  }

  # Catalog keys retain their private S3 origin and existing prefixes.
  origin {
    domain_name              = aws_s3_bucket.images.bucket_regional_domain_name
    origin_id                = "s3-catalog-images"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["assets/img/dishes/*", "assets/img/locations/*"]
    content {
      path_pattern           = ordered_cache_behavior.value
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = "s3-catalog-images"
      viewer_protocol_policy = "redirect-to-https"
      compress               = true
      min_ttl                = 0
      default_ttl            = 60
      max_ttl                = 3600
      forwarded_values {
        query_string = false
        cookies { forward = "none" }
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "cloudfront_distribution_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "images_cdn_base_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}
