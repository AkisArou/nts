export class DurationPattern {
  readonly hourMinute: string;
  readonly minuteSecond: string;
  readonly twoDigitHours: boolean;

  constructor(samples: readonly string[]) {
    if (samples.length !== 8) throw new Error("Missing duration pattern samples");
    const full = samples[0]!;
    const hm = samples[1]!;
    const ms = samples[2]!;
    const hour = samples[3]!;
    const paddedHour = samples[4]!;
    const minute = samples[6]!;
    const msMinute = ms.startsWith(minute) ? minute : samples[5]!;
    const second = samples[7]!;
    // CLDR can pad HMS hours but leave HM hours unpadded (es-CL, tk).
    this.twoDigitHours = full.startsWith(paddedHour);
    const hours = hm.startsWith(paddedHour) ? paddedHour : hour;
    const fullHours = this.twoDigitHours ? paddedHour : hour;
    if (
      !hm.startsWith(hours) ||
      !hm.endsWith(minute) ||
      !ms.startsWith(msMinute) ||
      !ms.endsWith(second)
    )
      throw new Error("Invalid duration pattern samples");
    this.hourMinute = hm.slice(hours.length, hm.length - minute.length);
    this.minuteSecond = ms.slice(msMinute.length, ms.length - second.length);
    if (
      this.hourMinute === "" ||
      this.minuteSecond === "" ||
      full !== fullHours + this.hourMinute + minute + this.minuteSecond + second
    )
      throw new Error("Inconsistent duration pattern samples");
  }
}
