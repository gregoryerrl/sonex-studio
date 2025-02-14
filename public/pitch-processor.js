class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.grainSize = 2048;
    this.pitchRatio = 1.0;
    this.overlapRatio = 0.5;
    this.grainWindow = this.createGrainWindow();
  }

  createGrainWindow() {
    const window = new Float32Array(this.grainSize);
    for (let i = 0; i < this.grainSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.grainSize));
    }
    return window;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) return true;

    const pitchRatio = parameters.pitch[0];
    const hopSize = Math.round(this.grainSize * this.overlapRatio);
    const numGrains = Math.ceil(input[0].length / hopSize);

    for (let i = 0; i < numGrains; i++) {
      const grainOffset = i * hopSize;
      const outputOffset = Math.round(grainOffset * pitchRatio);

      for (let j = 0; j < this.grainSize; j++) {
        const inputIndex = grainOffset + j;
        const outputIndex = outputOffset + j;

        if (outputIndex < output[0].length) {
          output[0][outputIndex] = input[0][inputIndex] * this.grainWindow[j];
        }
      }
    }

    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
