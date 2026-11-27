# O state deste bootstrap fica no próprio bucket que ele cria. O nome do bucket tem o número da conta, por isso não está
# aqui: vem de um backend.hcl fora do git (terraform init -backend-config=backend.hcl). Na primeira vez, antes de o bucket
# existir, um backend_override.tf (também fora do git) com backend "local" sobrepõe-se a este; depois do primeiro apply,
# apaga-se o override e o state passa para o bucket com terraform init -migrate-state.
terraform {
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true # lock nativo do S3: sem tabela do DynamoDB
  }
}
