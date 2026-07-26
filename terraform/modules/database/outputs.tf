output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "database_name" {
  value = aws_db_instance.main.db_name
}

output "username" {
  value     = aws_db_instance.main.username
  sensitive = true
}

output "connection_string" {
  value = "postgresql://${aws_db_instance.main.username}:${random_password.db_password.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
  sensitive = true
}

output "security_group_id" {
  value = aws_security_group.rds.id
}
