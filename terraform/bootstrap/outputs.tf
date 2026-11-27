output "state_bucket" {
  description = "Nome do bucket do state (vai para o backend.hcl de cada ambiente, fora do git)."
  value       = aws_s3_bucket.state.bucket
}
