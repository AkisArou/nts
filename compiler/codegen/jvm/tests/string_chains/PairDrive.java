import nts.gen.Program;
public final class PairDrive {
    public static void main(String[] args) {
        double[] values={0,-0.0,17.5,Double.NaN,Double.POSITIVE_INFINITY,Double.NEGATIVE_INFINITY,1e21,1e-7};
        for(int i=0;i<values.length;i++)for(boolean defined:new boolean[]{false,true})
            System.out.println(i+"/"+defined+"="+Program.optionalPair(values[i],defined));
    }
}
