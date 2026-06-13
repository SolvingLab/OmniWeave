// Nextflow DSL2 module in the nf-core shape: a process whose `script:` block is
// a single `template` directive pointing at an R script under templates/. This
// is the dominant cross-language mechanism across nf-core (each module ships its
// analysis as a template), distinct from Snakemake's `script:` directive — the
// capstone exercises BOTH engines so the crossLang synthesizer is gated on each.
process PREDICT {
    tag "$meta.id"
    label 'process_single'

    input:
    tuple val(meta), path(model_rds)

    output:
    tuple val(meta), path("*.predictions.tsv"), emit: predictions
    path "versions.yml"                       , emit: versions

    when:
    task.ext.when == null || task.ext.when

    script:
    template 'predict.R'
}
