# Bucket do state do Terraform, um por conta (os labs para o ensaio, a conta do Ledger para produção).
# Aplica-se à mão, no CloudShell da conta certa; o resto do Terraform guarda lá o state dele.

provider "aws" {
  region = var.region
  # Proteção contra a conta errada: com outras credenciais, o Terraform recusa-se a correr.
  allowed_account_ids = [var.account_id]
}

locals {
  # O número da conta torna o nome único no S3 (os nomes dos buckets são globais).
  state_bucket = "ledger-tfstate-${var.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket
  # Sem force_destroy: com o state lá dentro, o bucket nunca está vazio e o Terraform não o consegue apagar.
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cada escrita do state guarda a versão anterior: um state estragado volta atrás pela versão.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (grátis); uma chave KMS própria custava cerca de 1 $/mês.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# As versões antigas do state saem ao fim de 90 dias, para o bucket não crescer sem fim.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "versoes-antigas"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

# Só por HTTPS.
data "aws_iam_policy_document" "state" {
  statement {
    sid       = "SoHttps"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}
