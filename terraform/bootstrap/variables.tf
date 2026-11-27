variable "account_id" {
  description = "Número da conta AWS onde se pode aplicar (vem do terraform.tfvars, fora do git)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "O account_id tem de ter 12 algarismos."
  }
}

variable "region" {
  description = "Região da conta (a mesma do Ledger)."
  type        = string
  default     = "eu-west-1"
}
