// Export the level configuration
export const particleTestLevel = {
  id: "particleTest",
  name: "Particle Test Level",
  description: "Test level for particle effects",
  matrix: [
    // Row 1: Previously Row 0
    Array(10).fill("0"),
    // Row 1: Sparkle effects
    [
      "0",
      "T:1/TR:[@0|2|0]/AP:[C:[#FF0000|0|0|0|0|0]|0|0|0|0|0|1.0|0|0|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#00FF00|0|0|0|0|0]|0|0|0|0|0|1.0|0|0|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#0000FF|0|0|0|0|0]|0|0|0|0|0|1.0|0|0|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#FFFF00|0|0|0|0|0]|0|0|0|0|0|1.0|0|0|normal|sparkle|5]",
      ...Array(5).fill("0"),
    ],
    // Row 2: Empty
    Array(10).fill("0"),
    // Row 3: Wave effects
    [
      "0",
      "T:1/TR:[@0|2|0]/AP:[C:[#00FFFF|0|0|0|0|0]|0|0|0|0|0|1.0|wave|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#FF00FF|0|0|0|0|0]|0|0|0|0|0|1.0|wave|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#FFFFFF|0|0|0|0|0]|0|0|0|0|0|1.0|wave|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#FF8800|0|0|0|0|0]|0|0|0|0|0|1.0|wave|5|normal|sparkle|5]",
      ...Array(5).fill("0"),
    ],
    // Row 4: Empty
    Array(10).fill("0"),
    // Row 5: Ripple effects
    [
      "0",
      "T:1/TR:[@0|2|0]/AP:[C:[#FF0000|0|0|0|0|0]|0|0|0|0|0|1.0|ripple|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#FFFF00|0|0|0|0|0]|0|0|0|0|0|1.0|ripple|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#00FF00|0|0|0|0|0]|0|0|0|0|0|1.0|ripple|5|normal|sparkle|5]",
      "T:1/TR:[@0|2|0]/AP:[C:[#0000FF|0|0|0|0|0]|0|0|0|0|0|1.0|ripple|5|normal|sparkle|5]",
      ...Array(5).fill("0"),
    ],
    // Row 6: Empty
    Array(10).fill("0"),
    // Row 7: Explosion effect
    [
      ...Array(7).fill("0"),
      "T:1/TR:[@0|2|0]/AP:[C:[#FFFFFF|0|0|0|0|0]|0|0|0|0|0|1.0|twist|10|normal|sparkle|10]",
      ...Array(2).fill("0"),
    ],
    // Row 8: Player start
    ["0", "T:5/TR:[@0|2|0]/AP:[C:[#888888|0|0|0|0|0]|0|0|0|0|0|1.0|0|0|normal|0|0]", ...Array(8).fill("0")],
  ],
  startPosition: { x: 1, y: 9 }, // Player start position (y increased by 1 due to new top row)
  // Add any additional level-specific configurations
}
