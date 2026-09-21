"""Disease-detection model: PyTorch / EfficientNet-B0 loading and inference.

STRICT BOUNDARY: this package must never import or call the LLM/Gemini code in
`app.rag`. Gemini never performs image diagnosis.

Modules
-------
``labels.py``         class taxonomy and confidence thresholds. The
                      `disease_name` strings here are matched **exactly**
                      against `solutions.disease_name`.
``preprocessing.py``  Pillow validation, EXIF orientation fix, resize and
                      normalisation. Torch-free, so it is unit-testable.
``loader.py``         loads the fine-tuned checkpoint once at API startup.
``inference.py``      runs the forward pass and applies the product rules:
                      always a confidence score, and low confidence always
                      prompts for expert confirmation.
"""
