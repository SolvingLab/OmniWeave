#!/usr/bin/env Rscript
# Template script run by the Nextflow PREDICT process across the process boundary
# (crossLang). nf-core templates receive their inputs as Groovy-interpolated
# variables rather than argv; the body is ordinary R.

load_model <- function(path) {
  readRDS(path)
}

write_predictions <- function(values, path) {
  write.table(values, path, sep = "\t", quote = FALSE, row.names = FALSE)
}

model <- load_model("$model_rds")
write_predictions(model, "${meta.id}.predictions.tsv")
