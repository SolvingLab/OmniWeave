# Self-contained S4 model: the workflow rule `fit_model` crosses the process
# boundary into this script (crossLang), which DEFINES its own S4 class +
# generic + method — so the dispatch graph (contains/overrides) lights up
# inside the script the pipeline calls. This is the three-hop capstone.

setClass("GeneModel", representation(counts = "matrix", fitted = "logical"))

# Constructor function sharing the class name — the idiomatic Bioconductor pattern
# (cf. DESeq2's `DESeqDataSet()`). A bare `GeneModel(...)` call invokes THIS function;
# R classes are not directly callable. The bare-call router must resolve it to the
# constructor function at high confidence, not leave it an under-confident proximity
# guess that an agent would distrust.
GeneModel <- function(counts) {
  new("GeneModel", counts = counts, fitted = FALSE)
}

setGeneric("fit", function(object, ...) standardGeneric("fit"))

setMethod("fit", signature(object = "GeneModel"), function(object, ...) {
  object@fitted <- TRUE
  object
})

setGeneric("predict_expr", function(object) standardGeneric("predict_expr"))

setMethod("predict_expr", signature(object = "GeneModel"), function(object) {
  object@counts * 2
})

counts <- as.matrix(read.table(snakemake@input[["counts"]]))
model <- GeneModel(counts)
saveRDS(fit(model), snakemake@output[[1]])
